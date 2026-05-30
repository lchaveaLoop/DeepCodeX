import type { RepositoryInfo } from './repository.js'

export interface VerificationCommand {
  name: string
  command: string
  source: 'script'
  required: boolean
}

const STANDARD_VERIFICATION_SCRIPTS: Array<{ name: string; required: boolean }> = [
  { name: 'test', required: true },
  { name: 'build', required: true },
  { name: 'lint', required: true },
  { name: 'typecheck', required: false },
  { name: 'format:check', required: false },
]

function commandForScript(packageManager: string, scriptName: string): string {
  switch (packageManager) {
    case 'yarn':
      return `yarn ${scriptName}`
    case 'bun':
      return `bun run ${scriptName}`
    default:
      return `${packageManager} run ${scriptName}`
  }
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function inferVerificationCommands(repository: RepositoryInfo): VerificationCommand[] {
  const scriptNames = new Set(repository.scripts.map((script) => script.name))
  const packageManager = repository.packageManager?.name ?? 'npm'

  return STANDARD_VERIFICATION_SCRIPTS.filter((script) => scriptNames.has(script.name)).map(
    (script) => ({
      name: script.name,
      command: commandForScript(packageManager, script.name),
      source: 'script' as const,
      required: script.required,
    })
  )
}

export function matchVerificationCommand(
  command: string,
  commands: VerificationCommand[]
): VerificationCommand | null {
  const normalized = normalizeCommand(command)
  return commands.find((candidate) => normalizeCommand(candidate.command) === normalized) ?? null
}
