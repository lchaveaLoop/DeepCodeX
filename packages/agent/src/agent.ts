import {
  MAX_TOOL_ROUNDS,
  SYSTEM_PROMPT,
  getProviderConfig,
  DEFAULT_PROVIDER,
  MAX_LLM_RETRIES,
  LLM_RETRY_DELAY_MS,
  PLAN_ENABLED,
  PLAN_MIN_STEPS,
  PLAN_MAX_STEPS,
} from './config.js'
import { type StreamCallbacks, type ToolCall, type StreamedResponse } from './llm.js'
import { ToolRegistry } from './tools/index.js'
import { EventEmitter } from './core/event-emitter.js'
import { AgentEvent } from './core/event-types.js'
import type { LLMProvider } from './providers/llm-provider.js'
import { DeepSeekProvider } from './providers/deepseek-provider.js'
import { MiniMaxProvider } from './providers/minimax-provider.js'
import { logger } from './logger.js'
import { buildAgentContext } from './planning/agent-context.js'
import { TaskManager } from './planning/task-manager.js'
import { generatePlan } from './planning/planner.js'
import type { RecentAction } from './planning/types.js'

function createProvider() {
  const config = getProviderConfig()
  if (DEFAULT_PROVIDER === 'minimax') {
    return new MiniMaxProvider(config)
  }
  return new DeepSeekProvider(config)
}

export interface AgentCallbacks extends StreamCallbacks {
  onConfirm?: (_toolName: string, _args: Record<string, unknown>) => Promise<boolean>
  onToolResult?: (_tc: ToolCall, _result: string) => void
}

export interface AgentConfig {
  registry: ToolRegistry
  callbacks?: AgentCallbacks
  events?: EventEmitter
  maxRounds?: number
  systemPrompt?: string
  provider?: LLMProvider
  maxContextTokens?: number
  planning?: {
    enabled?: boolean
    minSteps?: number
    maxSteps?: number
  }
}

function isRetryableError(e: unknown): boolean {
  if (typeof e === 'object' && e !== null && 'status' in e) {
    const status = (e as { status: number }).status
    if (status === 429 || status >= 500) return true
    if (status === 401 || status === 400) return false
  }
  if (e instanceof Error) {
    const msg = e.message.toLowerCase()
    if (
      msg.includes('fetch failed') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('network')
    )
      return true
  }
  return false
}

export class Agent {
  private provider: LLMProvider
  private registry: ToolRegistry
  private messages: OpenAI.Chat.ChatCompletionMessageParam[]
  private events: EventEmitter
  private callbacks?: AgentCallbacks
  private maxRounds: number
  private systemPrompt: string
  private totalRounds = 0
  private maxContextTokens: number
  private contextThresholdRatio = 0.85
  totalTokensUsed = 0
  private recentActions: RecentAction[] = []
  private taskManager?: TaskManager
  private planEnabled: boolean
  private planMinSteps: number
  private planMaxSteps: number
  private hasLoadedHistory = false

  constructor(config: AgentConfig)
  constructor(registry: ToolRegistry, callbacks?: AgentCallbacks)
  constructor(
    registryOrConfig: ToolRegistry | AgentConfig,
    _callbacksOrEvents?: AgentCallbacks | EventEmitter
  ) {
    if (registryOrConfig instanceof ToolRegistry) {
      this.registry = registryOrConfig
      this.callbacks = _callbacksOrEvents as AgentCallbacks | undefined
      this.events = new EventEmitter()
      this.maxRounds = MAX_TOOL_ROUNDS
      this.systemPrompt = SYSTEM_PROMPT
      this.maxContextTokens = 128_000
      this.planEnabled = false
      this.planMinSteps = PLAN_MIN_STEPS
      this.planMaxSteps = PLAN_MAX_STEPS
      this.provider = new DeepSeekProvider({
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
      })
    } else {
      this.registry = registryOrConfig.registry
      this.callbacks = registryOrConfig.callbacks
      this.events = registryOrConfig.events ?? new EventEmitter()
      this.maxRounds = registryOrConfig.maxRounds ?? MAX_TOOL_ROUNDS
      this.systemPrompt = registryOrConfig.systemPrompt ?? SYSTEM_PROMPT
      this.maxContextTokens = registryOrConfig.maxContextTokens ?? 128_000
      this.planEnabled = registryOrConfig.planning?.enabled ?? PLAN_ENABLED
      this.planMinSteps = registryOrConfig.planning?.minSteps ?? PLAN_MIN_STEPS
      this.planMaxSteps = registryOrConfig.planning?.maxSteps ?? PLAN_MAX_STEPS
      this.provider = registryOrConfig.provider ?? createProvider()
    }

    this.messages = [{ role: 'system', content: this.systemPrompt }]
  }

  get messageHistory(): OpenAI.Chat.ChatCompletionMessageParam[] {
    return this.messages
  }

  get eventsEmitter(): EventEmitter {
    return this.events
  }

  get llmProvider(): LLMProvider {
    return this.provider
  }

  loadMessages(msgs: OpenAI.Chat.ChatCompletionMessageParam[]): void {
    this.messages = msgs
    this.hasLoadedHistory = true
  }

  private recordAction(action: string, result: string): void {
    this.recentActions.push({
      action,
      result: result.slice(0, 80),
      timestamp: Date.now(),
    })
    if (this.recentActions.length > 10) {
      this.recentActions.shift()
    }
  }

  private estimateTokens(): number {
    let chars = 0
    for (const msg of this.messages) {
      if (typeof msg.content === 'string') chars += msg.content.length
    }
    return Math.ceil(chars / 4)
  }

  private pruneContext(): void {
    const threshold = Math.floor(this.maxContextTokens * this.contextThresholdRatio)
    const estimated = this.estimateTokens()
    if (estimated <= threshold) return
    const system = this.messages[0]
    const rest = this.messages.slice(1)
    const keep = Math.max(2, Math.floor(rest.length * 0.6))
    const trimmed = rest.slice(-keep)
    this.messages = [system, ...trimmed]
    logger.warn('context pruned', {
      before: { messages: rest.length + 1, estimatedTokens: estimated },
      after: { messages: this.messages.length },
      threshold,
    })
  }

  private async retryStream(tools: Record<string, unknown>[]): Promise<StreamedResponse> {
    this.pruneContext()
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
      try {
        return await this.provider.stream(this.messages, tools, this.createStreamCallbacks())
      } catch (e) {
        lastError = e
        if (attempt >= MAX_LLM_RETRIES || !isRetryableError(e)) throw e
        const delay = LLM_RETRY_DELAY_MS * Math.pow(2, attempt)
        logger.warn('llm retry', { attempt: attempt + 1, delayMs: delay, error: String(e) })
        await new Promise((r) => setTimeout(r, delay))
      }
    }
    throw lastError
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

  private async executeTools(response: StreamedResponse): Promise<void> {
    for (const tc of response.toolCalls) {
      const tool = this.registry.get(tc.name)
      this.events.emit(AgentEvent.TOOL_START, { id: tc.id, name: tc.name })

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
        this.recordAction(`${tc.name} ${JSON.stringify(tc.arguments)}`, result)

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
  }

  // ── Core execution loop: LLM call → detect tools → execute → repeat ──
  private async executionLoop(tools: Record<string, unknown>[]): Promise<string> {
    for (let round = 1; round <= this.maxRounds; round++) {
      this.totalRounds = round
      this.events.emit(AgentEvent.ROUND_START, { round })
      this.events.emit(AgentEvent.LLM_REQUEST, {
        messageCount: this.messages.length,
        toolCount: tools.length,
      })

      const startTime = Date.now()

      try {
        const response = await this.retryStream(tools)

        if (response.usage) {
          this.totalTokensUsed += response.usage.totalTokens
        }

        const duration = Date.now() - startTime
        logger.info('llm response', {
          round,
          durationMs: duration,
          hasContent: !!response.content,
          hasToolCalls: response.toolCalls.length > 0,
          tokens: response.usage?.totalTokens ?? 0,
          totalAccumulated: this.totalTokensUsed,
        })
        this.events.emit(AgentEvent.LLM_RESPONSE, {
          hasContent: !!response.content,
          hasToolCalls: response.toolCalls.length > 0,
          hasReasoning: !!response.reasoning,
          duration,
        })

        if (response.reasoning) {
          this.events.emit(AgentEvent.REASONING_END, { fullText: response.reasoning })
        }

        const assistantMsg: Record<string, unknown> = { role: 'assistant' }
        if (response.content) assistantMsg.content = response.content
        if (response.reasoning) (assistantMsg as any).reasoning_content = response.reasoning
        if (response.toolCalls.length > 0) {
          assistantMsg.tool_calls = response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }))
        }

        this.messages.push(assistantMsg as any)
        this.events.emit(AgentEvent.MESSAGE_ASSISTANT, {
          content: response.content ?? null,
          toolCalls: response.toolCalls,
        })

        if (response.toolCalls.length === 0) {
          this.events.emit(AgentEvent.ROUND_END, { round })
          return response.content
        }

        await this.executeTools(response)
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        this.events.emit(AgentEvent.LLM_ERROR, { error })
        throw error
      }

      this.events.emit(AgentEvent.ROUND_END, { round })
    }

    this.events.emit(AgentEvent.MAX_ROUNDS, { maxRounds: this.maxRounds })
    return "I've reached the maximum number of tool-calling rounds. Please refine your question or ask me to continue."
  }

  // ── Plan-based execution ──
  private async executePlan(tools: Record<string, unknown>[]): Promise<string> {
    while (this.taskManager && !this.taskManager.isComplete()) {
      const step = this.taskManager.getCurrentStep()
      if (!step) break

      const progress = this.taskManager.getProgress()
      logger.info('plan step start', {
        stepId: step.id,
        description: step.description,
        progress: `${progress.done}/${progress.total}`,
      })

      this.messages.push({
        role: 'user',
        content: `Execute this task step: ${step.description}\n\nPlan progress: ${progress.done}/${progress.total} steps done.`,
      } as any)

      const stepResult = await this.executionLoop(tools)
      this.taskManager.markStepDone(step.id, stepResult)
      logger.info('plan step done', { stepId: step.id, resultLen: stepResult.length })
    }

    // All steps done — synthesize final answer
    if (this.taskManager) {
      this.messages.push({
        role: 'user',
        content: `All plan steps are complete. Summarize the results for the user.\n\n${this.taskManager.getPlanSummary()}`,
      } as any)
      return this.executionLoop(tools)
    }

    return 'Plan execution complete.'
  }

  async run(userInput: string): Promise<string> {
    this.totalRounds = 0
    this.recentActions = []
    logger.info('run start', { inputLen: userInput.length, provider: this.provider.model })
    this.messages.push({ role: 'user', content: userInput })
    this.events.emit(AgentEvent.RUN_START, { input: userInput })
    this.events.emit(AgentEvent.MESSAGE_USER, { content: userInput })

    const tools = this.registry.getDefinitions()

    // Phase 0 + 1: Environment perception & planning (if enabled)
    if (this.planEnabled) {
      try {
        const context = await buildAgentContext(
          this.registry,
          {
            maxRounds: this.maxRounds,
            maxContextTokens: this.maxContextTokens,
            currentTokensUsed: this.totalTokensUsed,
          },
          this.provider,
          this.messages.length,
          this.hasLoadedHistory,
          this.recentActions
        )

        const planSteps = await generatePlan(userInput, context, this.provider, this.planMaxSteps)

        if (planSteps.length >= this.planMinSteps) {
          logger.info('plan generated', {
            steps: planSteps.length,
            descriptions: planSteps.map((s) => s.description),
          })
          this.taskManager = new TaskManager(planSteps, userInput)
          const result = await this.executePlan(tools)
          this.events.emit(AgentEvent.RUN_END, { output: result, totalRounds: this.totalRounds })
          return result
        }
      } catch (e) {
        logger.warn('planning failed, falling back to standard mode', { error: String(e) })
      }
    }

    // Standard execution (existing behavior + fallback)
    const result = await this.executionLoop(tools)
    this.events.emit(AgentEvent.RUN_END, { output: result, totalRounds: this.totalRounds })
    return result
  }
}
