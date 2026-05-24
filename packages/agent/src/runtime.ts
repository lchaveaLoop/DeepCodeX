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

export interface AgentRunState {
  id: string
  input: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  totalRounds: number
  output?: string
  error?: string
  steps: RunStep[]
}
