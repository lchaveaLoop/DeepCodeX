export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'blocked' | 'skipped'

export type PlanStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cleared'

export interface PlanStep {
  id: string
  description: string
  status: PlanStepStatus
  result?: string
  dependsOn?: string[]
  startedAt?: string
  endedAt?: string
}

export interface AgentPlanState {
  id: string
  goal: string
  status: PlanStatus
  createdAt: string
  updatedAt: string
  steps: PlanStep[]
}

export interface PlanningConfig {
  enabled?: boolean
  mode?: 'auto' | 'always' | 'off'
  maxSteps?: number
}

export interface PlanDraft {
  goal: string
  steps: Array<{
    description: string
    dependsOn?: string[]
  }>
}
