import { z } from 'zod'
import OpenAI from 'openai'
import type { ToolDef } from './index.js'
import {
  MINIMAX_API_KEY,
  MINIMAX_BASE_URL,
  MINIMAX_MODEL,
  SEARCH_PROVIDER,
  DEFAULT_PROVIDER,
} from '../config.js'

export const WebSearchArgs = z.object({
  query: z.string().describe('Search query'),
  topK: z.number().int().min(1).max(10).default(5).describe('Number of results'),
})

type WebSearchArgs = z.infer<typeof WebSearchArgs>

// Real-browser UA — avoids scraper blocking
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// ── Google backend (default, free, no key) ──
const GOOGLE = 'https://www.google.com/search'

async function googleSearch(query: string, topK: number): Promise<string> {
  const resp = await fetch(`${GOOGLE}?q=${encodeURIComponent(query)}&hl=zh-CN`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!resp.ok) throw new Error(`Google returned HTTP ${resp.status}`)

  const html = await resp.text()

  // Detect captcha / block
  if (/verify you are human|captcha|unusual traffic|access denied/i.test(html)) {
    throw new Error('Google returned a captcha page (rate-limited)')
  }

  // Parse Google results
  // Each result: <a href="url"><h3>title</h3></a> ... snippet text nearby
  const resultRe =
    /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>\s*(?:<[^>]*>)*\s*<h3[^>]*>([\s\S]*?)<\/h3>\s*<\/a>[\s\S]{0,500}?(?:<span[^>]*>([\s\S]{20,300}?)<\/span>)/gi

  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = resultRe.exec(html)) !== null) {
    const url = m[1]
    const title = m[2].replace(/<[^>]*>/g, '').trim()
    const snippet = m[3]
      .replace(/<[^>]*>/g, '')
      .trim()
      .replace(/\s+/g, ' ')
    if (title && url && !url.includes('google.com')) {
      results.push(`${results.length + 1}. ${title}\n   ${url}\n   ${snippet}`)
    }
    if (results.length >= topK) break
  }

  if (results.length === 0) return `No results found for "${query}".`
  return results.join('\n\n')
}

// ── MiniMax backend (paid, uses API credits) ──
async function minimaxSearch(query: string, topK: number): Promise<string> {
  const client = new OpenAI({
    apiKey: MINIMAX_API_KEY,
    baseURL: MINIMAX_BASE_URL,
    maxRetries: 1,
  })

  const response = await client.chat.completions.create({
    model: MINIMAX_MODEL,
    messages: [
      { role: 'user', content: `Search the web for: ${query}\nReturn a list of search results.` },
    ],
    enable_web_search: true,
  } as any)

  const sources = (response as any).search_sources
  if (sources && Array.isArray(sources)) {
    const results = sources.slice(0, topK).map((s: any, i: number) => {
      const title = s.title ?? s.name ?? 'Link'
      const link = s.link ?? s.url ?? '#'
      const snippet = s.snippet ?? s.summary ?? ''
      return `${i + 1}. ${title}\n   ${link}\n   ${snippet}`
    })
    if (results.length > 0) return results.join('\n\n')
  }

  const text = response.choices?.[0]?.message?.content ?? ''
  if (text.trim()) return text.trim()

  throw new Error('MiniMax search returned empty results')
}

// ── Router ──
async function webSearch(args: WebSearchArgs): Promise<string> {
  const router = SEARCH_PROVIDER === 'auto' ? 'google' : SEARCH_PROVIDER
  const providers: Array<{ name: string; fn: () => Promise<string> }> = []

  if (router === 'google') {
    providers.push({ name: 'Google', fn: () => googleSearch(args.query, args.topK) })
    if (MINIMAX_API_KEY) {
      providers.push({ name: 'MiniMax (fallback)', fn: () => minimaxSearch(args.query, args.topK) })
    }
  } else if (router === 'minimax') {
    providers.push({ name: 'MiniMax', fn: () => minimaxSearch(args.query, args.topK) })
    providers.push({ name: 'Google (fallback)', fn: () => googleSearch(args.query, args.topK) })
  }

  for (const p of providers) {
    try {
      return await p.fn()
    } catch (e) {
      // continue to next provider
    }
  }

  return `Search failed: all providers exhausted for "${args.query}". Try a different query.`
}

export const webSearchTool: ToolDef<typeof WebSearchArgs> = {
  name: 'web_search',
  description:
    'Search the public web for current information. Returns ranked results with URL and snippet.',
  parameters: WebSearchArgs,
  handler: webSearch,
}
