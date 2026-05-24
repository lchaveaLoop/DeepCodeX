// OpenAI Compatible LLM Provider implementation

import OpenAI from 'openai'
import type { LLMConfig, LLMProvider, LLMResponse } from './llm-provider.js'
import type { StreamCallbacks, StreamedResponse, ToolCall } from '../llm.js'

interface OpenAIStreamDelta {
  content?: string | null
  reasoning_content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private _model: string

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 3,
    })
    this._model = config.model
  }

  get model(): string {
    return this._model
  }

  async chat(messages: unknown[], tools?: unknown[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this._model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.ChatCompletionTool[],
    })

    const choice = response.choices[0]
    const msg = choice?.message

    return {
      content: msg?.content ?? '',
      reasoning: null,
      toolCalls:
        msg?.tool_calls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        })) ?? [],
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    }
  }

  async stream(
    messages: unknown[],
    tools: unknown[],
    callbacks?: StreamCallbacks
  ): Promise<StreamedResponse> {
    const stream = await this.client.chat.completions.create({
      model: this._model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.ChatCompletionTool[],
      stream: true,
    })

    const contentParts: string[] = []
    const reasoningParts: string[] = []
    const tcBuf = new Map<number, { id: string; name: string; argsFrags: string[] }>()

    for await (const chunk of stream) {
      if (!chunk.choices?.length) continue

      const delta = chunk.choices[0].delta as OpenAIStreamDelta

      // ── Reasoning (some OpenAI-compatible APIs support it) ──
      const reasoning: string = delta.reasoning_content ?? ''
      if (reasoning) {
        for (const char of reasoning) {
          reasoningParts.push(char)
          callbacks?.onReasoning?.(char)
        }
      }

      // ── Content ──
      const content = delta.content ?? ''
      if (content) {
        for (const char of content) {
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
        // JSON fragment — skip
      }

      toolCalls.push({ id: buf.id, name: buf.name, arguments: arguments_ })
    }

    // Notify callbacks for each assembled tool call
    for (const tc of toolCalls) {
      callbacks?.onToolCall?.(tc)
    }

    return {
      content: contentParts.join(''),
      reasoning: reasoningParts.length ? reasoningParts.join('') : null,
      toolCalls,
    }
  }
}
