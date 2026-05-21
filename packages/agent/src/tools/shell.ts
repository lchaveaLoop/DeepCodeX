import { z } from 'zod'
import { execSync } from 'node:child_process'
import type { ToolDef } from './index.js'

export const RunCommandArgs = z.object({
  command: z.string().describe('Shell command to execute. Use with caution.'),
})

type RunCommandArgs = z.infer<typeof RunCommandArgs>

function runCommand(args: RunCommandArgs): string {
  try {
    const stdout = execSync(args.command, {
      encoding: 'utf-8',
      timeout: 30_000,
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    })

    const output = stdout.trim()
    if (!output) return '(command produced no output)'

    if (output.length > 2000) {
      return output.slice(0, 2000) + `\n... (truncated, ${output.length - 2000} more chars)`
    }

    return output
  } catch (e: any) {
    const msg = e?.stderr || e?.message || String(e)
    if (msg.length > 2000) {
      return msg.slice(0, 2000) + `\n... (truncated)`
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
