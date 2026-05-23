import fs from 'node:fs/promises'
import { execSync } from 'node:child_process'
import os from 'node:os'
import type { ToolRegistry } from '../tools/index.js'
import type { LLMProvider } from '../providers/llm-provider.js'
import { getWorkspaceRoot } from '../config.js'
import type { AgentContext, RecentAction } from './types.js'

function detectPlatform(): AgentContext['platform'] {
  const shell = process.env.SHELL ?? process.env.COMSPEC ?? 'unknown'
  return {
    os: process.platform,
    shell,
    homedir: os.homedir(),
  }
}

function checkCli(name: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? `where ${name} 2>nul` : `which ${name} 2>/dev/null`
    const out = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim().length > 0
  } catch {
    return false
  }
}

function detectEnvironment(): AgentContext['environment'] {
  let nodeVersion = 'unknown'
  try {
    nodeVersion = execSync('node --version', { encoding: 'utf-8', timeout: 2000 }).trim()
  } catch {
    /* keep unknown */
  }

  return {
    nodeVersion,
    gitAvailable: checkCli('git'),
    pythonAvailable: checkCli('python') || checkCli('python3'),
    npmAvailable: checkCli('npm'),
  }
}

export async function buildAgentContext(
  registry: ToolRegistry,
  constraints: { maxRounds: number; maxContextTokens: number; currentTokensUsed: number },
  provider: LLMProvider,
  messageCount: number,
  hasLoadedHistory: boolean,
  recentActions: RecentAction[]
): Promise<AgentContext> {
  const toolDefs = registry.getDefinitions()
  const tools = registry.listNames().map((name) => {
    const t = registry.get(name)
    return {
      name,
      description: t?.description ?? '',
      parameters: toolDefs.find((d: any) => d.function?.name === name)?.function?.parameters ?? {},
      requiresConfirm: t?.requiresConfirm ?? false,
    }
  })

  let topLevelEntries: string[] = []
  try {
    topLevelEntries = (await fs.readdir(getWorkspaceRoot()))
      .filter((e) => !e.startsWith('.'))
      .slice(0, 30)
  } catch {
    /* keep empty */
  }

  return {
    tools,
    workspace: {
      root: getWorkspaceRoot(),
      topLevelEntries,
      entryCount: topLevelEntries.length,
    },
    constraints,
    model: {
      name: provider.model,
      provider: (provider as any).constructor?.name?.replace('Provider', '').toLowerCase() ?? 'llm',
    },
    session: {
      messageCount,
      hasLoadedHistory,
    },
    platform: detectPlatform(),
    environment: detectEnvironment(),
    recentActions,
  }
}
