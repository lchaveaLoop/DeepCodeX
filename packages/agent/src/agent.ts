import OpenAI from 'openai'
import { API_KEY, BASE_URL, MAX_TOOL_ROUNDS, SYSTEM_PROMPT } from './config.js'
import { streamAndAccumulate, type StreamCallbacks, type ToolCall } from './llm.js'
import { type ToolRegistry } from './tools/index.js'

export interface AgentCallbacks extends StreamCallbacks {
  /** Called when a destructive tool needs user confirmation. Return true to proceed. */
  onConfirm?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>
  onToolResult?: (tc: ToolCall, result: string) => void
}

export class Agent {
  private client: OpenAI
  private registry: ToolRegistry
  private messages: OpenAI.Chat.ChatCompletionMessageParam[]
  private callbacks?: AgentCallbacks

  constructor(registry: ToolRegistry, callbacks?: AgentCallbacks) {
    if (!API_KEY) {
      throw new Error('DEEPSEEK_API_KEY not set in .env')
    }
    this.client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL })
    this.registry = registry
    this.callbacks = callbacks
    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }]
  }

  get messageHistory(): OpenAI.Chat.ChatCompletionMessageParam[] {
    return this.messages
  }

  loadMessages(msgs: OpenAI.Chat.ChatCompletionMessageParam[]): void {
    this.messages = msgs
  }

  async run(userInput: string): Promise<string> {
    this.messages.push({ role: 'user', content: userInput })
    const tools = this.registry.getDefinitions()

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await streamAndAccumulate(this.client, this.messages, tools, this.callbacks)

      // ── Build assistant message ──
      const assistantMsg: Record<string, unknown> = { role: 'assistant' }

      if (response.content) {
        assistantMsg.content = response.content
      }

      // DeepSeek requires reasoning_content to be passed back
      if (response.reasoning) {
        ;(assistantMsg as any).reasoning_content = response.reasoning
      }

      if (response.toolCalls.length > 0) {
        assistantMsg.tool_calls = response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }))
      }

      this.messages.push(assistantMsg as any)

      // ── No tool calls → final answer ──
      if (response.toolCalls.length === 0) {
        return response.content
      }

      // ── Execute tools ──
      for (const tc of response.toolCalls) {
        const tool = this.registry.get(tc.name)

        // Check confirmation
        if (tool?.requiresConfirm && this.callbacks?.onConfirm) {
          const approved = await this.callbacks.onConfirm(tc.name, tc.arguments)
          if (!approved) {
            this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: '[Rejected by user]',
            } as any)
            this.callbacks?.onToolResult?.(tc, '[Rejected by user]')
            continue
          }
        }

        const result = await this.registry.execute(tc.name, tc.arguments)
        this.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: result,
        } as any)
        this.callbacks?.onToolResult?.(tc, result)
      }
    }

    return (
      "I've reached the maximum number of tool-calling rounds. " +
      'Please refine your question or ask me to continue.'
    )
  }
}
