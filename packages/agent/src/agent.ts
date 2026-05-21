import OpenAI from 'openai'
import { API_KEY, BASE_URL, MAX_TOOL_ROUNDS, SYSTEM_PROMPT } from './config.js'
import { streamAndAccumulate, type StreamCallbacks, type ToolCall } from './llm.js'
import { ToolRegistry } from './tools/index.js'
import { EventEmitter } from './core/event-emitter.js'
import { AgentEvent } from './core/event-types.js'

export interface AgentCallbacks extends StreamCallbacks {
  /** Called when a destructive tool needs user confirmation. Return true to proceed. */
  onConfirm?: (_toolName: string, _args: Record<string, unknown>) => Promise<boolean>
  onToolResult?: (_tc: ToolCall, _result: string) => void
}

export interface AgentConfig {
  registry: ToolRegistry
  callbacks?: AgentCallbacks
  events?: EventEmitter
  maxRounds?: number
  systemPrompt?: string
}

export class Agent {
  private client: OpenAI
  private registry: ToolRegistry
  private messages: OpenAI.Chat.ChatCompletionMessageParam[]
  private events: EventEmitter
  private callbacks?: AgentCallbacks
  private maxRounds: number
  private systemPrompt: string
  private totalRounds = 0

  constructor(config: AgentConfig)
  constructor(registry: ToolRegistry, callbacks?: AgentCallbacks)
  constructor(
    registryOrConfig: ToolRegistry | AgentConfig,
    _callbacksOrEvents?: AgentCallbacks | EventEmitter
  ) {
    if (!API_KEY) {
      throw new Error('DEEPSEEK_API_KEY not set in .env')
    }

    this.client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL })

    // Overload: legacy constructor
    if (registryOrConfig instanceof ToolRegistry) {
      this.registry = registryOrConfig
      this.callbacks = _callbacksOrEvents as AgentCallbacks | undefined
      this.events = new EventEmitter()
      this.maxRounds = MAX_TOOL_ROUNDS
      this.systemPrompt = SYSTEM_PROMPT
    } else {
      // New constructor with config
      this.registry = registryOrConfig.registry
      this.callbacks = registryOrConfig.callbacks
      this.events = registryOrConfig.events ?? new EventEmitter()
      this.maxRounds = registryOrConfig.maxRounds ?? MAX_TOOL_ROUNDS
      this.systemPrompt = registryOrConfig.systemPrompt ?? SYSTEM_PROMPT
    }

    this.messages = [{ role: 'system', content: this.systemPrompt }]
  }

  get messageHistory(): OpenAI.Chat.ChatCompletionMessageParam[] {
    return this.messages
  }

  get eventsEmitter(): EventEmitter {
    return this.events
  }

  loadMessages(msgs: OpenAI.Chat.ChatCompletionMessageParam[]): void {
    this.messages = msgs
  }

  private createStreamCallbacks(): StreamCallbacks {
    return {
      onToken: (text) => {
        this.events.emit(AgentEvent.TOKEN, { text })
        this.callbacks?.onToken?.(text)
      },
      onReasoning: (text) => {
        this.events.emit(AgentEvent.REASONING_TOKEN, { text })
        this.callbacks?.onReasoning?.(text)
      },
      onToolCall: (tc) => {
        this.events.emit(AgentEvent.TOOL_CALL, {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        })
        this.callbacks?.onToolCall?.(tc)
      },
    }
  }

  async run(userInput: string): Promise<string> {
    this.totalRounds = 0
    this.messages.push({ role: 'user', content: userInput })
    this.events.emit(AgentEvent.RUN_START, { input: userInput })
    this.events.emit(AgentEvent.MESSAGE_USER, { content: userInput })

    const tools = this.registry.getDefinitions()

    for (let round = 1; round <= this.maxRounds; round++) {
      this.totalRounds = round
      this.events.emit(AgentEvent.ROUND_START, { round })
      this.events.emit(AgentEvent.LLM_REQUEST, {
        messageCount: this.messages.length,
        toolCount: tools.length,
      })

      const startTime = Date.now()

      try {
        const response = await streamAndAccumulate(
          this.client,
          this.messages,
          tools,
          this.createStreamCallbacks()
        )

        const duration = Date.now() - startTime
        this.events.emit(AgentEvent.LLM_RESPONSE, {
          hasContent: !!response.content,
          hasToolCalls: response.toolCalls.length > 0,
          hasReasoning: !!response.reasoning,
          duration,
        })

        if (response.reasoning) {
          this.events.emit(AgentEvent.REASONING_END, { fullText: response.reasoning })
        }

        // ── Build assistant message ──
        const assistantMsg: Record<string, unknown> = { role: 'assistant' }

        if (response.content) {
          assistantMsg.content = response.content
        }

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
        this.events.emit(AgentEvent.MESSAGE_ASSISTANT, {
          content: response.content ?? null,
          toolCalls: response.toolCalls,
        })

        // ── No tool calls → final answer ──
        if (response.toolCalls.length === 0) {
          this.events.emit(AgentEvent.ROUND_END, { round })
          this.events.emit(AgentEvent.RUN_END, {
            output: response.content ?? '',
            totalRounds: this.totalRounds,
          })
          return response.content
        }

        // ── Execute tools ──
        for (const tc of response.toolCalls) {
          const tool = this.registry.get(tc.name)
          this.events.emit(AgentEvent.TOOL_START, { id: tc.id, name: tc.name })

          // Check confirmation
          if (tool?.requiresConfirm) {
            this.events.emit(AgentEvent.TOOL_CONFIRM, { name: tc.name, args: tc.arguments })
            if (this.callbacks?.onConfirm) {
              const approved = await this.callbacks.onConfirm(tc.name, tc.arguments)
              if (!approved) {
                this.messages.push({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: '[Rejected by user]',
                } as any)
                this.events.emit(AgentEvent.TOOL_REJECTED, { name: tc.name, args: tc.arguments })
                this.events.emit(AgentEvent.MESSAGE_TOOL, {
                  toolCallId: tc.id,
                  content: '[Rejected by user]',
                })
                this.callbacks?.onToolResult?.(tc, '[Rejected by user]')
                continue
              }
            }
          }

          const toolStart = Date.now()
          try {
            const result = await this.registry.execute(tc.name, tc.arguments)
            const toolDuration = Date.now() - toolStart

            this.messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: result,
            } as any)

            this.events.emit(AgentEvent.TOOL_RESULT, {
              id: tc.id,
              name: tc.name,
              result,
              duration: toolDuration,
            })
            this.events.emit(AgentEvent.MESSAGE_TOOL, { toolCallId: tc.id, content: result })
            this.callbacks?.onToolResult?.(tc, result)
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e))
            this.events.emit(AgentEvent.TOOL_ERROR, { id: tc.id, name: tc.name, error })
          }
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        this.events.emit(AgentEvent.LLM_ERROR, { error })
        throw error
      }

      this.events.emit(AgentEvent.ROUND_END, { round })
    }

    this.events.emit(AgentEvent.MAX_ROUNDS, { maxRounds: this.maxRounds })
    const output =
      "I've reached the maximum number of tool-calling rounds. Please refine your question or ask me to continue."
    this.events.emit(AgentEvent.RUN_END, { output, totalRounds: this.totalRounds })
    return output
  }
}
