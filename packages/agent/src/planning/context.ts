import fs from 'node:fs'
import os from 'node:os'
import { getWorkspaceRoot } from '../config.js'
import type { LLMProvider } from '../providers/llm-provider.js'
import type { ToolRegistry } from '../tools/index.js'
import { analyzeRepository, type RepositoryInfo } from './repository.js'
import { inferVerificationCommands, type VerificationCommand } from './verification.js'

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
  repository: RepositoryInfo
  verification: {
    commands: VerificationCommand[]
  }
  model: {
    name: string
  }
  session: {
    messageCount: number
    hasLoadedHistory: boolean
  }
  platform: {
    os: NodeJS.Platform
    shell: string
    homedir: string
  }
}

export interface BuildAgentContextOptions {
  registry: ToolRegistry
  provider: LLMProvider
  messageCount: number
  hasLoadedHistory: boolean
}

export function buildAgentContext(options: BuildAgentContextOptions): AgentContext {
  const root = getWorkspaceRoot()
  let entries: string[] = []
  try {
    entries = fs
      .readdirSync(root)
      .filter((entry) => !entry.startsWith('.'))
      .slice(0, 50)
  } catch {
    entries = []
  }

  const definitions = options.registry.getDefinitions()
  const tools = options.registry.listNames().map((name) => {
    const tool = options.registry.get(name)
    const definition = definitions.find((item) => {
      const fn = (item as { function?: { name?: string } }).function
      return fn?.name === name
    }) as { function?: { parameters?: Record<string, unknown> } } | undefined

    return {
      name,
      description: tool?.description ?? '',
      parameters: definition?.function?.parameters ?? {},
      requiresConfirm: tool?.requiresConfirm ?? false,
    }
  })
  const repository = analyzeRepository(root)

  return {
    tools,
    workspace: {
      root,
      topLevelEntries: entries,
      entryCount: entries.length,
    },
    repository,
    verification: {
      commands: inferVerificationCommands(repository),
    },
    model: {
      name: options.provider.model,
    },
    session: {
      messageCount: options.messageCount,
      hasLoadedHistory: options.hasLoadedHistory,
    },
    platform: {
      os: process.platform,
      shell: process.env.SHELL ?? process.env.ComSpec ?? '',
      homedir: os.homedir(),
    },
  }
}
