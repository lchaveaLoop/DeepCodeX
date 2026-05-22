import OpenAI from 'openai'
import { MODEL } from './config.js'

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface StreamedResponse {
  content: string
  reasoning: string | null
  toolCalls: ToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

// ═══════════════════════════════════════════════════
// Streaming adapter
// ═══════════════════════════════════════════════════

export interface StreamCallbacks {
  onToken?: (_text: string) => void
  onReasoning?: (_text: string) => void
  onToolCall?: (_tc: ToolCall) => void
}

export async function streamAndAccumulate(
  client: OpenAI,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: Record<string, unknown>[],
  callbacks?: StreamCallbacks
): Promise<StreamedResponse> {
  const contentParts: string[] = []
  const reasoningParts: string[] = []

  // Tool-call accumulation: index → { id, name, argsFrags }
  const tcBuf = new Map<number, { id: string; name: string; argsFrags: string[] }>()

  const stream = await client.chat.completions.create({
    model: MODEL,
    messages,
    tools: tools as any,
    stream: true,
    reasoning_effort: 'high',
    stream_options: { include_usage: true },
    extra_body: { thinking: { type: 'enabled' } },
  })

  let streamUsage: StreamedResponse['usage']

  for await (const chunk of stream) {
    if (chunk.usage) {
      streamUsage = {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      }
    }
    if (!chunk.choices?.length) continue

    const delta = chunk.choices[0].delta as any

    // ── Reasoning (DeepSeek-specific) ──
    const reasoning: string = delta.reasoning_content ?? ''
    if (reasoning) {
      for (const char of reasoning) {
        reasoningParts.push(char)
        callbacks?.onReasoning?.(char)
      }
    }

    // ── Content ──
    if (delta.content) {
      for (const char of delta.content) {
        contentParts.push(char)
        callbacks?.onToken?.(char)
      }
    }

    // ── Tool calls (incremental fragments) ──
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index as number
        if (!tcBuf.has(idx)) {
          tcBuf.set(idx, { id: '', name: '', argsFrags: [] })
        }
        const buf = tcBuf.get(idx)!

        if (tc.id) buf.id = tc.id
        if (tc.function?.name) buf.name = tc.function.name
        if (tc.function?.arguments) buf.argsFrags.push(tc.function.arguments)
      }
    }
  }

  // ── Assemble tool calls ──
  const toolCalls: ToolCall[] = []
  for (const idx of [...tcBuf.keys()].sort()) {
    const buf = tcBuf.get(idx)!
    const argsStr = buf.argsFrags.join('')
    let arguments_: Record<string, unknown> = {}
    try {
      arguments_ = argsStr ? JSON.parse(argsStr) : {}
    } catch {
      // JSON fragment — skip and let Pydantic/Zod catch it
    }

    toolCalls.push({ id: buf.id, name: buf.name, arguments: arguments_ })
  }

  return {
    content: contentParts.join(''),
    reasoning: reasoningParts.length ? reasoningParts.join('') : null,
    toolCalls,
    usage: streamUsage,
  }
}
