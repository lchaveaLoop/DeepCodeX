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
