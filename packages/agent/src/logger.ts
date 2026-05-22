// Minimal structured logger — writes JSON to stderr to avoid polluting stdout

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const
type LogLevel = keyof typeof LEVELS

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info'
const threshold = LEVELS[currentLevel] ?? LEVELS.info

function log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
  if (LEVELS[level] < threshold) return
  const entry = { t: new Date().toISOString(), level, msg, ...(data ?? {}) }
  process.stderr.write(JSON.stringify(entry) + '\n')
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
  get level(): LogLevel {
    return currentLevel
  },
}
