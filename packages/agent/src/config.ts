import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// ── Load .env from project root ──
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..', '..', '..')
dotenv.config({ path: resolve(projectRoot, '.env') })

// ── DeepSeek (default) ──
export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? ''
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_MODEL = 'deepseek-v4-pro'

// ── MiniMax ──
export const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY ?? ''
export const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.chat/v1'
export const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'abab6.5s-chat'

// ── Default Provider Config ──
export const DEFAULT_PROVIDER = (process.env.DEFAULT_PROVIDER ?? 'deepseek') as
  | 'deepseek'
  | 'minimax'

export function getProviderConfig() {
  switch (DEFAULT_PROVIDER) {
    case 'minimax':
      return {
        apiKey: MINIMAX_API_KEY,
        baseURL: MINIMAX_BASE_URL,
        model: MINIMAX_MODEL,
      }
    case 'deepseek':
    default:
      return {
        apiKey: DEEPSEEK_API_KEY,
        baseURL: DEEPSEEK_BASE_URL,
        model: DEEPSEEK_MODEL,
      }
  }
}

// ── Legacy exports for backward compatibility ──
export const API_KEY = DEEPSEEK_API_KEY
export const BASE_URL = DEEPSEEK_BASE_URL
export const MODEL = DEEPSEEK_MODEL

// ── Agent ──
export const MAX_TOOL_ROUNDS = 10
export const MAX_LLM_RETRIES = 3
export const LLM_RETRY_DELAY_MS = 1000

// ── Planning ──
export const PLAN_ENABLED = process.env.PLAN_ENABLED !== 'false'
export const PLAN_MIN_STEPS = Number(process.env.PLAN_MIN_STEPS ?? 2)
export const PLAN_MAX_STEPS = Number(process.env.PLAN_MAX_STEPS ?? 7)

export const SYSTEM_PROMPT = `You are a helpful code assistant with access to workspace tools.
Use tools to read files, write files, run shell commands, and search the web.
After each tool observation, decide whether you need more context or can answer the user.`

// ── Workspace ──
let _workspaceRoot = resolve(process.cwd())
export function getWorkspaceRoot(): string {
  return _workspaceRoot
}
export function setWorkspaceRoot(path: string): void {
  _workspaceRoot = path
}
export const BLOCKED_PATH_NAMES = new Set([
  '.env',
  '.git',
  '.venv',
  '__pycache__',
  '.reasonix',
  'node_modules',
])

// ── Shell security ──
export const SHELL_ALLOWED_COMMANDS = process.env.SHELL_ALLOWED_COMMANDS
  ? new Set(process.env.SHELL_ALLOWED_COMMANDS.split(',').map((s) => s.trim()))
  : null // null = all commands allowed (except blocked)

export const SHELL_BLOCKED_COMMANDS = process.env.SHELL_BLOCKED_COMMANDS
  ? new Set(process.env.SHELL_BLOCKED_COMMANDS.split(',').map((s) => s.trim()))
  : new Set<string>()

export const DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+(-[rRf]+\s+)*(\/|\*|~|\.\.)/, label: 'destructive remove' },
  { pattern: /\bcurl\b.+\|\s*(bash|sh|zsh)/, label: 'curl-pipe-shell' },
  { pattern: /\bwget\b.+\|\s*(bash|sh|zsh)/, label: 'wget-pipe-shell' },
  { pattern: /\bsudo\b/, label: 'sudo' },
  { pattern: /\bchmod\s+[0-7]*7[0-7]*7/, label: 'permissive chmod' },
  { pattern: /\b(chown|chgrp)\b/, label: 'ownership change' },
  { pattern: /\b:\(\)\s*\{/, label: 'fork bomb' },
  { pattern: /\bdd\s+if=/, label: 'disk write' },
  { pattern: /\b>(\s*)\/dev\//, label: 'device write' },
]

export function detectDangerousPatterns(command: string): string[] {
  return DANGEROUS_PATTERNS.filter((p) => p.pattern.test(command)).map((p) => p.label)
}

// ── Search provider ──
export const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER ?? 'auto') as
  | 'auto'
  | 'duckduckgo'
  | 'minimax'
