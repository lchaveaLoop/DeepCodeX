import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// ── Load .env from project root ──
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..', '..', '..')
dotenv.config({ path: resolve(projectRoot, '.env') })

// ── API ──
export const API_KEY = process.env.DEEPSEEK_API_KEY ?? ''
export const BASE_URL = 'https://api.deepseek.com'
export const MODEL = 'deepseek-v4-pro'

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
