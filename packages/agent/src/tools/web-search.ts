import { z } from 'zod'
import type { ToolDef } from './index.js'

// ═══════════════════════════════════════════════════
// web_search
// ═══════════════════════════════════════════════════

export const WebSearchArgs = z.object({
  query: z.string().describe('Search query'),
  topK: z.number().int().min(1).max(10).default(5).describe('Number of results'),
})

type WebSearchArgs = z.infer<typeof WebSearchArgs>

async function webSearch(args: WebSearchArgs): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'FAgent/0.1 (code-assistant)' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!resp.ok) {
      return `Error: search returned HTTP ${resp.status}`
    }

    const html = await resp.text()

    // Parse DuckDuckGo HTML results
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
      if (results.length >= args.topK) break
    }

    if (results.length === 0) {
      return `No results found for "${args.query}".`
    }

    return results.join('\n\n')
  } catch (e: unknown) {
    const err = e as Error
    return `Error: web search failed — ${err?.message || e}`
  }
}

export const webSearchTool: ToolDef<typeof WebSearchArgs> = {
  name: 'web_search',
  description:
    'Search the public web for current information. Returns ranked results with URL and snippet.',
  parameters: WebSearchArgs,
  handler: webSearch,
}
