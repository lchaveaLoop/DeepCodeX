import { MAX_TOOL_ROUNDS, SYSTEM_PROMPT, getProviderConfig } from './config.js'
import { type StreamCallbacks, type ToolCall } from './llm.js'
import { ToolRegistry, type ToolExecutionInfo, type ToolExecutionResult } from './tools/index.js'
import { EventEmitter } from './core/event-emitter.js'
import { AgentEvent } from './core/event-types.js'
import type OpenAI from 'openai'
import type { LLMProvider } from './providers/llm-provider.js'
import { DeepSeekProvider } from './providers/deepseek-provider.js'
import type { AgentRunState, RunStatus, RunStepKind, WorkspaceChange } from './runtime.js'
import {
  type AgentContext,
  buildAgentContext,
  createPlanDraft,
  matchVerificationCommand,
  normalizePlanningConfig,
  shouldCreatePlan,
  TaskManager,
  type AgentPlanState,
  type PlanningConfig,
} from './planning/index.js'

function createProvider() {
  return new DeepSeekProvider(getProviderConfig())
}

export interface AgentCallbacks extends StreamCallbacks {
  /** Called when a destructive tool needs user confirmation. Return true to proceed. */
  onConfirm?: (
    _toolName: string,
    _args: Record<string, unknown>,
    _execution?: ToolExecutionInfo
  ) => Promise<boolean>
  onToolResult?: (_tc: ToolCall, _result: string) => void
  onPlanUpdate?: (_plan: AgentPlanState) => void
}

export interface AgentConfig {
  registry: ToolRegistry
  callbacks?: AgentCallbacks
  events?: EventEmitter
  maxRounds?: number
  systemPrompt?: string
  provider?: LLMProvider
  planning?: PlanningConfig
}

type AssistantMessageWithReasoning = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
  reasoning_content?: string
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
  private currentRunState: AgentRunState | null = null
  private taskManager = new TaskManager()
  private planningConfig: Required<PlanningConfig>
  private hasLoadedHistory = false

  constructor(config: AgentConfig)
  constructor(registry: ToolRegistry, callbacks?: AgentCallbacks)
  constructor(
    registryOrConfig: ToolRegistry | AgentConfig,
    _callbacksOrEvents?: AgentCallbacks | EventEmitter
  ) {
    // Overload: legacy constructor uses DeepSeek for backward compatibility
    if (registryOrConfig instanceof ToolRegistry) {
      this.registry = registryOrConfig
      this.callbacks = _callbacksOrEvents as AgentCallbacks | undefined
      this.events = new EventEmitter()
      this.maxRounds = MAX_TOOL_ROUNDS
      this.systemPrompt = SYSTEM_PROMPT
      this.planningConfig = normalizePlanningConfig()
      // Legacy constructor always uses DeepSeek (tests mock streamAndAccumulate)
      this.provider = new DeepSeekProvider({
        apiKey: process.env.DEEPSEEK_API_KEY ?? '',
        baseURL: 'https://api.deepseek.com',
        model: 'deepseek-v4-pro',
      })
    } else {
      // New constructor with config
      this.registry = registryOrConfig.registry
      this.callbacks = registryOrConfig.callbacks
      this.events = registryOrConfig.events ?? new EventEmitter()
      this.maxRounds = registryOrConfig.maxRounds ?? MAX_TOOL_ROUNDS
      this.systemPrompt = registryOrConfig.systemPrompt ?? SYSTEM_PROMPT
      this.provider = registryOrConfig.provider ?? createProvider()
      this.planningConfig = normalizePlanningConfig(registryOrConfig.planning)
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

  get currentRun(): AgentRunState | null {
    return this.currentRunState
  }

  get currentPlan(): AgentPlanState | null {
    return this.taskManager.currentPlan
  }

  loadMessages(msgs: OpenAI.Chat.ChatCompletionMessageParam[]): void {
    this.messages = msgs
    this.hasLoadedHistory = true
  }

  clearPlan(): void {
    this.taskManager.clearPlan()
    this.events.emit(AgentEvent.PLAN_CLEARED, {})
  }

  private startRun(input: string): AgentRunState {
    const timestamp = new Date().toISOString()
    this.currentRunState = {
      id: `run_${Date.now()}`,
      input,
      status: 'running',
      startedAt: timestamp,
      totalRounds: 0,
      workspaceChanges: {
        changed: false,
        changes: [],
      },
      steps: [],
    }
    return this.currentRunState
  }

  private finishRun(status: RunStatus, output?: string, error?: Error): void {
    if (!this.currentRunState) return

    this.currentRunState.status = status
    this.currentRunState.totalRounds = this.totalRounds
    this.currentRunState.endedAt = new Date().toISOString()
    if (output !== undefined) {
      this.currentRunState.output = output
    }
    if (error) {
      this.currentRunState.error = error.message
    }
  }

  private recordStep(
    kind: RunStepKind,
    options: {
      round?: number
      toolCallId?: string
      toolName?: string
      data?: Record<string, unknown>
    } = {}
  ): void {
    if (!this.currentRunState) return

    const index = this.currentRunState.steps.length
    this.currentRunState.steps.push({
      id: `step_${index + 1}`,
      index,
      kind,
      timestamp: new Date().toISOString(),
      ...options,
    })
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

  private buildCurrentContext(): AgentContext {
    return buildAgentContext({
      registry: this.registry,
      provider: this.provider,
      messageCount: this.messages.length,
      hasLoadedHistory: this.hasLoadedHistory,
    })
  }

  private initializeVerification(context: AgentContext): void {
    if (!this.currentRunState) return
    this.currentRunState.verification = {
      commands: context.verification.commands,
      results: [],
    }
  }

  private async maybeCreatePlan(userInput: string, context: AgentContext): Promise<void> {
    if (!shouldCreatePlan(userInput, this.planningConfig)) return

    try {
      const draft = await createPlanDraft({
        provider: this.provider,
        userInput,
        context,
        maxSteps: this.planningConfig.maxSteps,
      })
      if (!draft) return

      const plan = this.taskManager.createPlan(draft)
      this.events.emit(AgentEvent.PLAN_CREATED, { plan })
      this.emitPlanUpdate(plan)
      const step = this.taskManager.currentStep
      if (step) this.events.emit(AgentEvent.PLAN_STEP_START, { plan, step })
    } catch {
      // Planning is advisory. Invalid JSON or provider errors fall back to normal execution.
    }
  }

  private messagesWithPlanContext(): OpenAI.Chat.ChatCompletionMessageParam[] {
    const contextParts: string[] = []

    if (this.currentPlan) {
      contextParts.push(
        'Current execution plan for this run. Use it to stay oriented, but keep following the user request and available tools.\n' +
          this.taskManager.formatSummary()
      )
    }

    const verification = this.currentRunState?.verification
    if (verification && verification.commands.length > 0) {
      const required = verification.commands.filter((command) => command.required)
      const optional = verification.commands.filter((command) => !command.required)
      const results = verification.results.map((result) => `${result.command}: ${result.status}`)

      contextParts.push(
        [
          'Verification requirements for this run.',
          required.length > 0
            ? `Required verification commands: ${required.map((command) => command.command).join(', ')}`
            : 'Required verification commands: none',
          optional.length > 0
            ? `Optional verification commands: ${optional.map((command) => command.command).join(', ')}`
            : '',
          results.length > 0 ? `Verification results so far: ${results.join(', ')}` : '',
          'Run required verification before final delivery when code, files, or commands changed the workspace.',
        ]
          .filter(Boolean)
          .join('\n')
      )
    }

    if (contextParts.length === 0) return this.messages

    return [
      ...this.messages,
      {
        role: 'system',
        content: contextParts.join('\n\n'),
      },
    ]
  }

  private emitPlanUpdate(plan: AgentPlanState | null): void {
    if (!plan) return
    this.events.emit(AgentEvent.PLAN_UPDATED, { plan })
    this.callbacks?.onPlanUpdate?.(plan)
  }

  private completePlanStep(result: string): void {
    const step = this.taskManager.currentStep
    const plan = this.taskManager.completeCurrentStep(result)
    if (!plan || !step) return
    this.events.emit(AgentEvent.PLAN_STEP_COMPLETE, { plan, step })
    this.emitPlanUpdate(plan)
    const next = this.taskManager.currentStep
    if (next) this.events.emit(AgentEvent.PLAN_STEP_START, { plan, step: next })
  }

  private failPlanStep(reason: string): void {
    const step = this.taskManager.currentStep
    const plan = this.taskManager.failCurrentStep(reason)
    if (!plan || !step) return
    this.events.emit(AgentEvent.PLAN_STEP_FAIL, { plan, step, reason })
    this.emitPlanUpdate(plan)
  }

  private blockPlanStep(reason: string): void {
    const step = this.taskManager.currentStep
    const plan = this.taskManager.blockCurrentStep(reason)
    if (!plan || !step) return
    this.events.emit(AgentEvent.PLAN_STEP_FAIL, { plan, step, reason })
    this.emitPlanUpdate(plan)
  }

  private failPlan(reason: string): void {
    const plan = this.taskManager.failPlan(reason)
    if (plan) this.emitPlanUpdate(plan)
  }

  private pendingRequiredVerificationCommands(): string[] {
    const verification = this.currentRunState?.verification
    if (!verification || !this.currentRunState?.workspaceChanges?.changed) return []

    return verification.commands
      .filter((command) => command.required)
      .filter((command) => {
        const latest = [...verification.results]
          .reverse()
          .find((result) => result.command === command.command)
        return latest?.status !== 'passed'
      })
      .map((command) => command.command)
  }

  private requestPendingVerification(round: number, commands: string[]): void {
    const content = [
      'Required verification is still pending before final delivery.',
      `Run these commands with run_command: ${commands.join(', ')}`,
      'After verification passes, provide the final answer.',
    ].join('\n')

    this.messages.push({ role: 'system', content })
    this.recordStep('verification_required', {
      round,
      data: { commands, content },
    })
  }

  private recordToolExecutionResult(
    tc: ToolCall,
    round: number,
    result: ToolExecutionResult
  ): void {
    const toolMessage: OpenAI.Chat.ChatCompletionToolMessageParam = {
      role: 'tool',
      tool_call_id: tc.id,
      content: result.content,
    }
    this.messages.push(toolMessage)
    this.recordStep('tool_result', {
      round,
      toolCallId: tc.id,
      toolName: tc.name,
      data: {
        result: result.content,
        content: result.content,
        ok: result.ok,
        error: result.error,
        duration: result.duration,
        execution: result.execution,
      },
    })

    this.events.emit(AgentEvent.TOOL_RESULT, {
      id: tc.id,
      name: tc.name,
      result: result.content,
      content: result.content,
      ok: result.ok,
      error: result.error,
      duration: result.duration,
      execution: result.execution,
    })
    this.events.emit(AgentEvent.MESSAGE_TOOL, { toolCallId: tc.id, content: result.content })
    this.callbacks?.onToolResult?.(tc, result.content)
    this.recordVerificationResult(tc, round, result)
    this.recordWorkspaceChange(tc, round, result)

    if (result.ok) {
      this.completePlanStep(result.content)
    } else {
      this.failPlanStep(result.error ?? result.content)
    }
  }

  private recordWorkspaceChange(tc: ToolCall, round: number, result: ToolExecutionResult): void {
    if (!result.ok || !this.currentRunState?.workspaceChanges) return

    const timestamp = new Date().toISOString()
    let change: WorkspaceChange | null = null

    if (tc.name === 'write_file') {
      const target = typeof tc.arguments.path === 'string' ? tc.arguments.path : undefined
      change = {
        kind: 'file_write',
        sourceTool: tc.name,
        target,
        summary: target ? `write_file ${target}` : 'write_file',
        confidence: 'confirmed',
        toolCallId: tc.id,
        round,
        timestamp,
      }
    }

    if (
      tc.name === 'run_command' &&
      (result.execution?.risk === 'medium' || result.execution?.risk === 'high')
    ) {
      const command = typeof tc.arguments.command === 'string' ? tc.arguments.command : undefined
      change = {
        kind: 'command',
        sourceTool: tc.name,
        command,
        summary: command ?? result.execution.summary,
        confidence: 'possible',
        toolCallId: tc.id,
        round,
        timestamp,
      }
    }

    if (!change) return

    this.currentRunState.workspaceChanges.changed = true
    this.currentRunState.workspaceChanges.changes.push(change)
    this.recordStep('workspace_change', {
      round,
      toolCallId: tc.id,
      toolName: tc.name,
      data: { ...change },
    })
  }

  private recordVerificationResult(tc: ToolCall, round: number, result: ToolExecutionResult): void {
    if (tc.name !== 'run_command') return
    if (!this.currentRunState?.verification) return

    const command = typeof tc.arguments.command === 'string' ? tc.arguments.command : ''
    const match = matchVerificationCommand(command, this.currentRunState.verification.commands)
    if (!match) return

    const timestamp = new Date().toISOString()
    const verificationResult = {
      name: match.name,
      command: match.command,
      ok: result.ok,
      status: result.ok ? ('passed' as const) : ('failed' as const),
      content: result.content,
      error: result.error,
      duration: result.duration,
      toolCallId: tc.id,
      round,
      timestamp,
    }

    this.currentRunState.verification.results.push(verificationResult)
    this.recordStep('verification_result', {
      round,
      toolCallId: tc.id,
      toolName: tc.name,
      data: verificationResult,
    })
  }

  private async executeToolCall(tc: ToolCall, round: number): Promise<void> {
    const tool = this.registry.get(tc.name)
    const execution = this.registry.describeExecution(tc.name, tc.arguments)
    this.recordStep('tool_call', {
      round,
      toolCallId: tc.id,
      toolName: tc.name,
      data: { arguments: tc.arguments, execution },
    })
    this.events.emit(AgentEvent.TOOL_START, { id: tc.id, name: tc.name })

    if (execution?.blocked) {
      const result = await this.registry.executeDetailed(tc.name, tc.arguments)
      this.recordToolExecutionResult(tc, round, result)
      return
    }

    if (tool?.requiresConfirm) {
      this.events.emit(AgentEvent.TOOL_CONFIRM, { name: tc.name, args: tc.arguments, execution })
      if (this.callbacks?.onConfirm) {
        const approved = await this.callbacks.onConfirm(tc.name, tc.arguments, execution)
        if (!approved) {
          const content = '[Rejected by user]'
          const rejectedMessage: OpenAI.Chat.ChatCompletionToolMessageParam = {
            role: 'tool',
            tool_call_id: tc.id,
            content,
          }
          this.messages.push(rejectedMessage)
          this.recordStep('tool_rejected', {
            round,
            toolCallId: tc.id,
            toolName: tc.name,
            data: { ok: false, content, error: content, execution },
          })
          this.events.emit(AgentEvent.TOOL_REJECTED, { name: tc.name, args: tc.arguments })
          this.events.emit(AgentEvent.MESSAGE_TOOL, {
            toolCallId: tc.id,
            content,
          })
          this.callbacks?.onToolResult?.(tc, content)
          this.blockPlanStep(content)
          return
        }
      }
    }

    const result = await this.registry.executeDetailed(tc.name, tc.arguments)
    this.recordToolExecutionResult(tc, round, result)
  }

  async run(userInput: string): Promise<string> {
    this.totalRounds = 0
    this.startRun(userInput)
    this.messages.push({ role: 'user', content: userInput })
    this.recordStep('user_message', { data: { content: userInput } })
    this.events.emit(AgentEvent.RUN_START, { input: userInput })
    this.events.emit(AgentEvent.MESSAGE_USER, { content: userInput })
    const context = this.buildCurrentContext()
    this.initializeVerification(context)
    await this.maybeCreatePlan(userInput, context)

    const tools = this.registry.getDefinitions()

    for (let round = 1; round <= this.maxRounds; round++) {
      this.totalRounds = round
      this.currentRunState!.totalRounds = round
      this.recordStep('round_start', { round })
      this.events.emit(AgentEvent.ROUND_START, { round })
      this.recordStep('llm_request', {
        round,
        data: { messageCount: this.messagesWithPlanContext().length, toolCount: tools.length },
      })
      this.events.emit(AgentEvent.LLM_REQUEST, {
        messageCount: this.messagesWithPlanContext().length,
        toolCount: tools.length,
      })

      const startTime = Date.now()

      try {
        const response = await this.provider.stream(
          this.messagesWithPlanContext(),
          tools,
          this.createStreamCallbacks()
        )

        const duration = Date.now() - startTime
        this.recordStep('llm_response', {
          round,
          data: {
            hasContent: !!response.content,
            hasToolCalls: response.toolCalls.length > 0,
            hasReasoning: !!response.reasoning,
            duration,
          },
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

        // ── Build assistant message ──
        const assistantMsg: AssistantMessageWithReasoning = { role: 'assistant' }

        if (response.content) {
          assistantMsg.content = response.content
        }

        if (response.reasoning) {
          assistantMsg.reasoning_content = response.reasoning
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

        this.messages.push(assistantMsg)
        this.recordStep('assistant_message', {
          round,
          data: {
            content: response.content ?? null,
            toolCallCount: response.toolCalls.length,
          },
        })
        this.events.emit(AgentEvent.MESSAGE_ASSISTANT, {
          content: response.content ?? null,
          toolCalls: response.toolCalls,
        })

        // ── No tool calls → final answer ──
        if (response.toolCalls.length === 0) {
          const pendingVerification = this.pendingRequiredVerificationCommands()
          if (pendingVerification.length > 0) {
            this.requestPendingVerification(round, pendingVerification)
            this.events.emit(AgentEvent.ROUND_END, { round })
            continue
          }

          if (this.taskManager.currentStep) {
            this.completePlanStep(response.content ?? '')
          }
          this.events.emit(AgentEvent.ROUND_END, { round })
          this.recordStep('final', { round, data: { output: response.content ?? '' } })
          this.finishRun('completed', response.content ?? '')
          this.events.emit(AgentEvent.RUN_END, {
            output: response.content ?? '',
            totalRounds: this.totalRounds,
          })
          return response.content
        }

        // ── Execute tools ──
        for (const tc of response.toolCalls) {
          await this.executeToolCall(tc, round)
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        this.recordStep('error', { round, data: { error: error.message } })
        this.finishRun('failed', undefined, error)
        this.events.emit(AgentEvent.LLM_ERROR, { error })
        throw error
      }

      this.events.emit(AgentEvent.ROUND_END, { round })
    }

    this.events.emit(AgentEvent.MAX_ROUNDS, { maxRounds: this.maxRounds })
    this.failPlan('Maximum tool-calling rounds reached')
    const output =
      "I've reached the maximum number of tool-calling rounds. Please refine your question or ask me to continue."
    this.recordStep('max_rounds', { data: { maxRounds: this.maxRounds, output } })
    this.finishRun('max_rounds', output)
    this.events.emit(AgentEvent.RUN_END, { output, totalRounds: this.totalRounds })
    return output
  }
}
