import { z } from 'zod'
import { execSync } from 'node:child_process'
import { getWorkspaceRoot } from '../config.js'
import type { ToolDef, ToolExecutionInfo, ToolRiskLevel } from './index.js'

export const RunCommandArgs = z.object({
  command: z.string().describe('Shell command to execute. Use with caution.'),
})

type RunCommandArgs = z.infer<typeof RunCommandArgs>

function compactCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ')
}

function previewCommand(command: string): string {
  const compacted = compactCommand(command)
  return compacted.length > 160 ? `${compacted.slice(0, 157)}...` : compacted
}

function hasAny(command: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(command))
}

export function assessCommandSafety(command: string): ToolExecutionInfo {
  const compacted = compactCommand(command)
  const lower = compacted.toLowerCase()
  const reasons: string[] = []
  let risk: ToolRiskLevel = 'low'

  const blockedRules: Array<[RegExp, string]> = [
    [/\bgit\s+reset\b(?=.*--hard)/, 'git reset --hard can discard workspace changes'],
    [/\bgit\s+clean\b(?=.*-[a-z]*f)(?=.*-[a-z]*d)/, 'git clean -fd can delete untracked files'],
    [
      /\brm\s+-[a-z]*r[a-z]*f\b\s+(?:\/|~|\*|\.)(?:\s|$)/,
      'recursive force delete targets a broad or root-like path',
    ],
    [
      /\b(?:curl|wget)\b.+\|\s*(?:sh|bash|zsh|powershell|pwsh)\b/,
      'remote script piped directly into a shell',
    ],
  ]

  for (const [pattern, reason] of blockedRules) {
    if (pattern.test(lower)) reasons.push(reason)
  }

  if (reasons.length > 0) {
    return {
      summary: previewCommand(command),
      risk: 'blocked',
      blocked: true,
      requiresConfirmation: false,
      reasons,
    }
  }

  const highRiskRules: Array<[RegExp, string]> = [
    [/\brm\s+-[a-z]*r[a-z]*f\b/, 'recursive force delete'],
    [/\brm\b|\bdel\b|\brmdir\b/, 'deletes files or directories'],
    [/\bremove-item\b(?=.*\b-recurse\b)/, 'recursive PowerShell delete'],
    [/\bgit\s+push\b(?=.*--force)/, 'force push rewrites remote history'],
    [/\bchmod\b(?=.*-r\b)|\bchown\b(?=.*-r\b)/, 'recursive permission or ownership change'],
    [/\bnpm\s+publish\b|\bpnpm\s+publish\b|\byarn\s+publish\b/, 'publishes a package'],
  ]

  for (const [pattern, reason] of highRiskRules) {
    if (pattern.test(lower)) reasons.push(reason)
  }

  if (reasons.length > 0) {
    risk = 'high'
  } else if (
    hasAny(lower, [
      /\bnpm\s+(?:install|i)\b/,
      /\bpnpm\s+(?:install|add)\b/,
      /\byarn\s+(?:install|add)\b/,
      /\bpip\s+install\b/,
      /\bgit\s+(?:commit|push|pull|merge|rebase|checkout|switch)\b/,
      /\bmv\b|\bmove\b|\bcp\b|\bcopy\b|\bmkdir\b|\btouch\b/,
      /(?:^|\s)(?:>|>>)(?:\s|$)/,
    ])
  ) {
    risk = 'medium'
    reasons.push('command may change files, dependencies, or repository state')
  }

  return {
    summary: previewCommand(command),
    risk,
    blocked: false,
    requiresConfirmation: true,
    reasons,
  }
}

function runCommand(args: RunCommandArgs): string {
  const safety = assessCommandSafety(args.command)
  if (safety.blocked) {
    return (
      `Error: command blocked by safety policy: ${safety.summary}` +
      (safety.reasons.length > 0 ? `\nReasons:\n- ${safety.reasons.join('\n- ')}` : '')
    )
  }

  try {
    const stdout = execSync(args.command, {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: getWorkspaceRoot(),
      maxBuffer: 10 * 1024 * 1024,
    })

    const output = stdout.trim()
    if (!output) return '(command produced no output)'

    if (output.length > 2000) {
      return output.slice(0, 2000) + `\n... (truncated, ${output.length - 2000} more chars)`
    }

    return output
  } catch (e: unknown) {
    const err = e as Error
    const msg = err?.message || String(e)
    if (msg.length > 2000) {
      return `Error: command failed: ${msg.slice(0, 2000)}\n... (truncated)`
    }
    return `Error: command failed: ${msg}`
  }
}

export const runCommandTool: ToolDef<typeof RunCommandArgs> = {
  name: 'run_command',
  description: 'Run a shell command in the workspace. The user must confirm before execution.',
  parameters: RunCommandArgs,
  handler: runCommand,
  requiresConfirm: true,
  describeExecution: ({ command }) => assessCommandSafety(command),
}
