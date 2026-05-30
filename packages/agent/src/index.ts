export { Agent } from './agent.js'
export type { AgentCallbacks, AgentConfig } from './agent.js'

export { streamAndAccumulate } from './llm.js'
export type { StreamedResponse, ToolCall, StreamCallbacks } from './llm.js'

export { ToolRegistry, createRegistry } from './tools/index.js'
export type {
  ToolDef,
  ToolExecutionInfo,
  ToolExecutionResult,
  ToolRiskLevel,
} from './tools/index.js'

export { saveSession, loadSession } from './session.js'
export type { SessionMessage } from './session.js'
export type {
  AgentRunState,
  RunStatus,
  RunStep,
  RunStepKind,
  VerificationResult,
  VerificationRunState,
  WorkspaceChange,
  WorkspaceChangeConfidence,
  WorkspaceChangeKind,
  WorkspaceChangeState,
} from './runtime.js'
export {
  TaskManager,
  analyzeRepository,
  buildAgentContext,
  createPlanDraft,
  inferVerificationCommands,
  matchVerificationCommand,
  normalizePlanningConfig,
  shouldCreatePlan,
} from './planning/index.js'
export type {
  AgentContext,
  AgentPlanState,
  BuildAgentContextOptions,
  GitRepositoryInfo,
  PackageManagerInfo,
  PlanDraft,
  PlanningConfig,
  PlanStatus,
  PlanStep,
  PlanStepStatus,
  RepositoryInfo,
  RepositoryScript,
  VerificationCommand,
} from './planning/index.js'

export * as config from './config.js'

export { EventEmitter } from './core/event-emitter.js'
export { AgentEvent } from './core/event-types.js'
export type { AgentEventData, AgentEventName } from './core/event-types.js'

export { DeepSeekProvider } from './providers/deepseek-provider.js'
export { OpenAIProvider } from './providers/openai-provider.js'
export {
  createLLMProvider,
  type LLMProvider,
  type LLMConfig,
  type LLMResponse,
} from './providers/llm-provider.js'
