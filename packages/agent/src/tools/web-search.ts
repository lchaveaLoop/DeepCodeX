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

// ── DuckDuckGo backend ──
async function duckduckgoSearch(query: string, topK: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'FAgent/0.1 (code-assistant)' },
    signal: AbortSignal.timeout(10_000),
  })

  if (!resp.ok) {
    throw new Error(`DuckDuckGo returned HTTP ${resp.status}`)
  }

  const html = await resp.text()

  const resultRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*?)<\/a>/gi

  const results: string[] = []
  let match: RegExpExecArray | null
  while ((match = resultRegex.exec(html)) !== null) {
    const url = match[1]
    const title = match[2].replace(/<[^>]*>/g, '').trim()
    const snippet = match[3].replace(/<[^>]*>/g, '').trim()
    if (title && snippet) {
      results.push(`${results.length + 1}. ${title}\n   ${url}\n   ${snippet}`)
    }
    if (results.length >= topK) break
  }

  if (results.length === 0) {
    return `No results found for "${query}".`
  }

  return results.join('\n\n')
}

// ── MiniMax backend ──
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

  const text = response.choices?.[0]?.message?.content ?? ''

  // Try to extract search sources from MiniMax's response
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

  // Fallback: return the model's text response
  if (text.trim()) return text.trim()

  throw new Error('MiniMax search returned empty results')
}

// ── Router ──
async function webSearch(args: WebSearchArgs): Promise<string> {
  const provider =
    SEARCH_PROVIDER === 'auto'
      ? DEFAULT_PROVIDER === 'minimax' && MINIMAX_API_KEY
        ? 'minimax'
        : 'duckduckgo'
      : SEARCH_PROVIDER

  const errors: string[] = []

  // Try primary provider
  if (provider === 'minimax') {
    try {
      return await minimaxSearch(args.query, args.topK)
    } catch (e) {
      errors.push(`MiniMax search: ${e instanceof Error ? e.message : e}`)
    }
  } else {
    try {
      return await duckduckgoSearch(args.query, args.topK)
    } catch (e) {
      errors.push(`DuckDuckGo: ${e instanceof Error ? e.message : e}`)
    }
  }

  // Fallback: try the other provider
  const fallback = provider === 'minimax' ? 'duckduckgo' : 'minimax'
  try {
    if (fallback === 'duckduckgo') {
      return await duckduckgoSearch(args.query, args.topK)
    } else if (MINIMAX_API_KEY) {
      return await minimaxSearch(args.query, args.topK)
    }
  } catch (e) {
    errors.push(`${fallback} fallback: ${e instanceof Error ? e.message : e}`)
  }

  return `Search failed:\n${errors.join('\n')}`
}

export const webSearchTool: ToolDef<typeof WebSearchArgs> = {
  name: 'web_search',
  description:
    'Search the public web for current information. Returns ranked results with URL and snippet.',
  parameters: WebSearchArgs,
  handler: webSearch,
}
