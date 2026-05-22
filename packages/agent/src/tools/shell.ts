import { z } from 'zod'
import { execSync } from 'node:child_process'
import type { ToolDef } from './index.js'
import {
  SHELL_ALLOWED_COMMANDS,
  SHELL_BLOCKED_COMMANDS,
  detectDangerousPatterns,
  getWorkspaceRoot,
} from '../config.js'
import { logger } from '../logger.js'

const MAX_OUTPUT_LENGTH = 2000

export const RunCommandArgs = z.object({
  command: z.string().describe('Shell command to execute. Use with caution.'),
})

type RunCommandArgs = z.infer<typeof RunCommandArgs>

function checkSecurity(command: string): string | null {
  const baseCommand = command.trim().split(/\s+/)[0]

  if (SHELL_ALLOWED_COMMANDS && !SHELL_ALLOWED_COMMANDS.has(baseCommand)) {
    return `Blocked: '${baseCommand}' is not in the allowed commands list`
  }

  if (SHELL_BLOCKED_COMMANDS.has(baseCommand)) {
    return `Blocked: '${baseCommand}' is in the blocked commands list`
  }

  const dangerous = detectDangerousPatterns(command)
  if (dangerous.length > 0) {
    return `SECURITY WARNING — detected patterns: ${dangerous.join(
      ', '
    )}. This command requires extra scrutiny before execution.`
  }

  return null
}

function runCommand(args: RunCommandArgs): string {
  const securityIssue = checkSecurity(args.command)
  if (securityIssue) {
    logger.warn('shell security flag', { command: args.command, reason: securityIssue })
    return `Error: ${securityIssue}`
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

    if (output.length > MAX_OUTPUT_LENGTH) {
      return (
        output.slice(0, MAX_OUTPUT_LENGTH) +
        `\n... (truncated, ${output.length - MAX_OUTPUT_LENGTH} more chars)`
      )
    }

    return output
  } catch (e: unknown) {
    const err = e as Error
    const msg = err?.message || String(e)
    if (msg.length > MAX_OUTPUT_LENGTH) {
      return msg.slice(0, MAX_OUTPUT_LENGTH) + `\n... (truncated)`
    }
    return msg
  }
}

export const runCommandTool: ToolDef<typeof RunCommandArgs> = {
  name: 'run_command',
  description: 'Run a shell command in the workspace. The user must confirm before execution.',
  parameters: RunCommandArgs,
  handler: runCommand,
  requiresConfirm: true,
}
