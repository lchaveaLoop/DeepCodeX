export { TaskManager } from './task-manager.js'
export { buildAgentContext } from './context.js'
export type { AgentContext, BuildAgentContextOptions } from './context.js'
export { analyzeRepository } from './repository.js'
export type {
  GitRepositoryInfo,
  PackageManagerInfo,
  RepositoryInfo,
  RepositoryScript,
} from './repository.js'
export { inferVerificationCommands, matchVerificationCommand } from './verification.js'
export type { VerificationCommand } from './verification.js'
export { createPlanDraft, normalizePlanningConfig, shouldCreatePlan } from './planner.js'
export type {
  AgentPlanState,
  PlanDraft,
  PlanningConfig,
  PlanStatus,
  PlanStep,
  PlanStepStatus,
} from './types.js'
