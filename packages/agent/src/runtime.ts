import type { VerificationCommand } from './planning/index.js'

export type RunStatus = 'running' | 'completed' | 'max_rounds' | 'failed'

export type RunStepKind =
  | 'user_message'
  | 'round_start'
  | 'llm_request'
  | 'llm_response'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'tool_rejected'
  | 'tool_error'
  | 'workspace_change'
  | 'verification_result'
  | 'verification_required'
  | 'final'
  | 'max_rounds'
  | 'error'

export interface RunStep {
  id: string
  index: number
  kind: RunStepKind
  timestamp: string
  round?: number
  toolCallId?: string
  toolName?: string
  data?: Record<string, unknown>
}

export interface VerificationResult {
  name: string
  command: string
  ok: boolean
  status: 'passed' | 'failed'
  content: string
  error?: string
  duration: number
  toolCallId: string
  round: number
  timestamp: string
}

export interface VerificationRunState {
  commands: VerificationCommand[]
  results: VerificationResult[]
}

export type WorkspaceChangeKind = 'file_write' | 'command'
export type WorkspaceChangeConfidence = 'confirmed' | 'possible'

export interface WorkspaceChange {
  kind: WorkspaceChangeKind
  sourceTool: string
  summary: string
  confidence: WorkspaceChangeConfidence
  toolCallId: string
  round: number
  timestamp: string
  target?: string
  command?: string
}

export interface WorkspaceChangeState {
  changed: boolean
  changes: WorkspaceChange[]
}

export interface AgentRunState {
  id: string
  input: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  totalRounds: number
  output?: string
  error?: string
  workspaceChanges?: WorkspaceChangeState
  verification?: VerificationRunState
  steps: RunStep[]
}
