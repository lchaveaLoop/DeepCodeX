// LLM Provider interface for model abstraction

import type { ToolCall, StreamCallbacks, StreamedResponse } from '../llm.js'

export interface LLMConfig {
  apiKey: string
  baseURL: string
  model: string
  maxRetries?: number
}

export interface LLMResponse {
  content: string
  reasoning: string | null
  toolCalls: ToolCall[]
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface LLMProvider {
  chat(messages: unknown[], tools?: unknown[]): Promise<LLMResponse>
  stream(
    messages: unknown[],
    tools: unknown[],
    callbacks?: StreamCallbacks
  ): Promise<StreamedResponse>
  readonly model: string
}

export async function createLLMProvider(config: LLMConfig): Promise<LLMProvider> {
  if (config.baseURL.includes('deepseek')) {
    const { DeepSeekProvider } = await import('./deepseek-provider.js')
    return new DeepSeekProvider(config)
  }
  const { OpenAIProvider } = await import('./openai-provider.js')
  return new OpenAIProvider(config)
}
