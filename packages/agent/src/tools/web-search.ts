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

// ── Bing backend (default, free, no key) ──
const BING = 'https://cn.bing.com/search'

async function bingSearch(query: string, topK: number): Promise<string> {
  const resp = await fetch(`${BING}?q=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  })

  if (!resp.ok) throw new Error(`Bing returned HTTP ${resp.status}`)

  const html = await resp.text()

  // Detect captcha / block
  if (/verify you are human|captcha|access denied/i.test(html)) {
    throw new Error('Bing returned a captcha page (rate-limited)')
  }

  // Parse: <li class="b_algo"> → <h2><a href="...">title</a></h2> → <div class="b_caption"><p>snippet</p>
  const blockRe =
    /<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>\s*(?:<[^>]*>)*\s*<p[^>]*>([\s\S]*?)<\/p>/gi

  const results: string[] = []
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null) {
    const url = m[1]
    const title = m[2].replace(/<[^>]*>/g, '').trim()
    const snippet = m[3]
      .replace(/<[^>]*>/g, '')
      .trim()
      .replace(/\s+/g, ' ')
    if (title && url) {
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
  const router = SEARCH_PROVIDER === 'auto' ? 'bing' : SEARCH_PROVIDER
  const providers: Array<{ name: string; fn: () => Promise<string> }> = []

  if (router === 'bing') {
    providers.push({ name: 'Bing', fn: () => bingSearch(args.query, args.topK) })
    // Fallback to MiniMax if key available
    if (MINIMAX_API_KEY) {
      providers.push({ name: 'MiniMax (fallback)', fn: () => minimaxSearch(args.query, args.topK) })
    }
  } else if (router === 'minimax') {
    providers.push({ name: 'MiniMax', fn: () => minimaxSearch(args.query, args.topK) })
    providers.push({ name: 'Bing (fallback)', fn: () => bingSearch(args.query, args.topK) })
  } else if (router === 'duckduckgo') {
    // DuckDuckGo HTML was unreliable — use Bing instead
    providers.push({ name: 'Bing', fn: () => bingSearch(args.query, args.topK) })
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
