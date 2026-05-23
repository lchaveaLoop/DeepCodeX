// ── Plan step ──
export interface PlanStep {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped'
  result?: string
  dependsOn?: string[]
}

// ── Recent action ──
export interface RecentAction {
  action: string
  result: string
  timestamp: number
}

// ── Agent context (Phase 0: environment perception) ──
export interface AgentContext {
  tools: Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    requiresConfirm: boolean
  }>

  workspace: {
    root: string
    topLevelEntries: string[]
    entryCount: number
  }

  constraints: {
    maxRounds: number
    maxContextTokens: number
    currentTokensUsed: number
  }

  model: {
    name: string
    provider: string
  }

  session: {
    messageCount: number
    hasLoadedHistory: boolean
  }

  platform: {
    os: string
    shell: string
    homedir: string
  }

  environment: {
    nodeVersion: string
    gitAvailable: boolean
    pythonAvailable: boolean
    npmAvailable: boolean
  }

  recentActions: RecentAction[]
}
