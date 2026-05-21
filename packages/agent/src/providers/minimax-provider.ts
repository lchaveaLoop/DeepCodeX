// MiniMax LLM Provider implementation

import type { LLMConfig, LLMProvider, LLMResponse } from './llm-provider.js'
import { streamAndAccumulate, type StreamCallbacks, type StreamedResponse } from '../llm.js'
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
    return streamAndAccumulate(
      this.client,
      messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools,
      callbacks
    )
  }
}
