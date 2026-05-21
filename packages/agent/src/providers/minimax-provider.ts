// MiniMax LLM Provider implementation

import type { LLMConfig, LLMProvider, LLMResponse } from './llm-provider.js'
import type { StreamCallbacks, StreamedResponse } from '../llm.js'
import OpenAI from 'openai'

const THINK_START = '</think>'
const THINK_END = '<think>'

export class MiniMaxProvider implements LLMProvider {
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

    // Strip thinking tags from content
    let content = msg?.content ?? ''
    content = content.replace(new RegExp(`${THINK_START}[\\s\\S]*?${THINK_END}`, 'g'), '')

    return {
      content,
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
    const contentParts: string[] = []
    const reasoningParts: string[] = []
    const toolCallsMap = new Map<number, { id: string; name: string; argsFrags: string[] }>()

    let inThinking = false

    const stream = await this.client.chat.completions.create({
      model: this._model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.CompletionTool[],
      stream: true,
    })

    for await (const chunk of stream) {
      if (!chunk.choices?.length) continue

      const delta = chunk.choices[0].delta as any

      if (delta?.content) {
        const text = delta.content as string

        // Handle thinking tags
        if (text === THINK_START) {
          inThinking = true
          continue
        }
        if (text === THINK_END) {
          inThinking = false
          continue
        }

        if (inThinking) {
          // Accumulate reasoning
          reasoningParts.push(text)
          callbacks?.onReasoning?.(text)
        } else {
          // Emit tokens character by character for streaming effect
          for (const char of text) {
            contentParts.push(char)
            callbacks?.onToken?.(char)
          }
        }
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index as number
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: '', name: '', argsFrags: [] })
          }
          const buf = toolCallsMap.get(idx)!
          if (tc.id) buf.id = tc.id
          if (tc.function?.name) buf.name = tc.function.name
          if (tc.function?.arguments) buf.argsFrags.push(tc.function.arguments)
        }
      }
    }

    const toolCalls: StreamedResponse['toolCalls'] = []
    for (const idx of [...toolCallsMap.keys()].sort()) {
      const buf = toolCallsMap.get(idx)!
      const argsStr = buf.argsFrags.join('')
      let arguments_: Record<string, unknown> = {}
      try {
        arguments_ = argsStr ? JSON.parse(argsStr) : {}
      } catch {
        // Skip invalid JSON
      }
      toolCalls.push({ id: buf.id, name: buf.name, arguments: arguments_ })
    }

    return {
      content: contentParts.join(''),
      reasoning: reasoningParts.join('') || null,
      toolCalls,
    }
  }
}
