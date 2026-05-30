// Event types for Agent

export const AgentEvent = {
  // Agent lifecycle
  RUN_START: 'agent:run:start',
  RUN_END: 'agent:run:end',
  ROUND_START: 'agent:round:start',
  ROUND_END: 'agent:round:end',
  MAX_ROUNDS: 'agent:max-rounds',

  // LLM events
  LLM_REQUEST: 'llm:request',
  LLM_RESPONSE: 'llm:response',
  LLM_ERROR: 'llm:error',
  TOKEN: 'llm:token',
  REASONING_START: 'llm:reasoning:start',
  REASONING_TOKEN: 'llm:reasoning:token',
  REASONING_END: 'llm:reasoning:end',

  // Tool events
  TOOL_CALL: 'tool:call',
  TOOL_START: 'tool:start',
  TOOL_RESULT: 'tool:result',
  TOOL_ERROR: 'tool:error',
  TOOL_CONFIRM: 'tool:confirm',
  TOOL_REJECTED: 'tool:rejected',

  // Plan events
  PLAN_CREATED: 'plan:created',
  PLAN_UPDATED: 'plan:updated',
  PLAN_STEP_START: 'plan:step:start',
  PLAN_STEP_COMPLETE: 'plan:step:complete',
  PLAN_STEP_FAIL: 'plan:step:fail',
  PLAN_CLEARED: 'plan:cleared',

  // Message events
  MESSAGE_ADD: 'message:add',
  MESSAGE_USER: 'message:user',
  MESSAGE_ASSISTANT: 'message:assistant',
  MESSAGE_TOOL: 'message:tool',
} as const

export type AgentEventName = (typeof AgentEvent)[keyof typeof AgentEvent]

export interface AgentEventData {
  'agent:run:start': { input: string }
  'agent:run:end': { output: string; totalRounds: number }
  'agent:round:start': { round: number }
  'agent:round:end': { round: number }
  'agent:max-rounds': { maxRounds: number }

  'llm:request': { messageCount: number; toolCount: number }
  'llm:response': {
    hasContent: boolean
    hasToolCalls: boolean
    hasReasoning: boolean
    duration: number
  }
  'llm:error': { error: Error }
  'llm:token': { text: string }
  'llm:reasoning:start': Record<string, never>
  'llm:reasoning:token': { text: string }
  'llm:reasoning:end': { fullText: string }

  'tool:call': { id: string; name: string; arguments: Record<string, unknown> }
  'tool:start': { id: string; name: string }
  'tool:result': {
    id: string
    name: string
    result: string
    content?: string
    ok?: boolean
    error?: string
    execution?: unknown
    duration: number
  }
  'tool:error': { id: string; name: string; error: Error }
  'tool:confirm': { name: string; args: Record<string, unknown>; execution?: unknown }
  'tool:rejected': { name: string; args: Record<string, unknown> }

  'plan:created': { plan: unknown }
  'plan:updated': { plan: unknown }
  'plan:step:start': { plan: unknown; step: unknown }
  'plan:step:complete': { plan: unknown; step: unknown }
  'plan:step:fail': { plan: unknown; step: unknown; reason: string }
  'plan:cleared': Record<string, never>

  'message:add': { role: string; content: unknown }
  'message:user': { content: string }
  'message:assistant': { content: string | null; toolCalls: unknown[] }
  'message:tool': { toolCallId: string; content: string }
}
