// MiniMax LLM Provider implementation

import type { LLMConfig, LLMProvider, LLMResponse } from './llm-provider.js'
import type { StreamCallbacks, StreamedResponse } from '../llm.js'
import OpenAI from 'openai'

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
    const contentParts: string[] = []
    const toolCallsMap = new Map<number, { id: string; name: string; argsFrags: string[] }>()

    const stream = await this.client.chat.completions.create({
      model: this._model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.ChatCompletionTool[],
      stream: true,
    })

    for await (const chunk of stream) {
      if (!chunk.choices?.length) continue

      const delta = chunk.choices[0].delta as any

      if (delta?.content) {
        contentParts.push(delta.content)
        callbacks?.onToken?.(delta.content)
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
      reasoning: null,
      toolCalls,
    }
  }
}
