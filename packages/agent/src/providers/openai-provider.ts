// OpenAI Compatible LLM Provider implementation

import OpenAI from 'openai'
import type { LLMConfig, LLMProvider, LLMResponse } from './llm-provider.js'

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

  async stream(messages: unknown[], tools: unknown[], _callbacks?: unknown): Promise<LLMResponse> {
    const stream = await this.client.chat.completions.create({
      model: this._model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      tools: tools as OpenAI.Chat.ChatCompletionTool[],
      stream: true,
    })

    let content = ''
    const toolCalls: LLMResponse['toolCalls'] = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (delta?.content) {
        content += delta.content
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              arguments: {},
            }
          }
          if (tc.function?.arguments) {
            toolCalls[idx].arguments = JSON.parse(
              (toolCalls[idx].arguments as any) + tc.function.arguments
            )
          }
        }
      }
    }

    return { content, reasoning: null, toolCalls }
  }
}
