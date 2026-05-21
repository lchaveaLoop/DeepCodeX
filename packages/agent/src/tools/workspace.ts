import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ToolDef } from './index.js'
import { getWorkspaceRoot, BLOCKED_PATH_NAMES } from '../config.js'

// ═══════════════════════════════════════════════════
// Security helpers
// ═══════════════════════════════════════════════════

function resolvePath(filePath: string): string {
  return path.resolve(getWorkspaceRoot(), filePath)
}

function isInsideWorkspace(absPath: string): boolean {
  const root = getWorkspaceRoot()
  const rel = path.relative(root, absPath)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

function isBlocked(absPath: string): boolean {
  const parts = absPath.split(path.sep)
  return parts.some((p) => BLOCKED_PATH_NAMES.has(p))
}

// ═══════════════════════════════════════════════════
// read_file
// ═══════════════════════════════════════════════════

export const ReadFileArgs = z.object({
  path: z.string().describe('File path relative to workspace root'),
  startLine: z.number().int().optional().describe('1-indexed start line'),
  endLine: z.number().int().optional().describe('1-indexed end line'),
})

type ReadFileArgs = z.infer<typeof ReadFileArgs>

async function readFile(args: ReadFileArgs): Promise<string> {
  const target = resolvePath(args.path)

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path}' is blocked`
  }

  let content: string
  try {
    content = await fs.readFile(target, 'utf-8')
  } catch {
    return `Error: file not found: ${args.path}`
  }

  const lines = content.split('\n')
  const total = lines.length

  const start = Math.max(0, (args.startLine ?? 1) - 1)
  const end = Math.min(total, args.endLine ?? total)
  const selected = lines.slice(start, end)

  const numbered = selected
    .slice(0, 500)
    .map((line, i) => `${String(start + i + 1).padStart(4)}| ${line}`)

  let result = numbered.join('\n')
  if (selected.length > 500) {
    result += `\n... (${selected.length - 500} more lines omitted)`
  }

  if (args.startLine === undefined && args.endLine === undefined && total > 200) {
    // Return head + tail preview for long files
    const head = lines.slice(0, 50).map((l, i) => `${String(i + 1).padStart(4)}| ${l}`)
    const tail = lines
      .slice(total - 50)
      .map((l, i) => `${String(total - 49 + i).padStart(4)}| ${l}`)
    return `${head.join('\n')}\n... (${total - 100} lines omitted)\n${tail.join('\n')}`
  }

  return result
}

// ═══════════════════════════════════════════════════
// write_file
// ═══════════════════════════════════════════════════

export const WriteFileArgs = z.object({
  path: z.string().describe('File path relative to workspace root'),
  content: z.string().describe('Full content to write to the file'),
})

type WriteFileArgs = z.infer<typeof WriteFileArgs>

async function writeFile(args: WriteFileArgs): Promise<string> {
  const target = resolvePath(args.path)

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path}' is blocked`
  }

  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, args.content, 'utf-8')

  const lineCount = args.content.split('\n').length
  const byteLen = Buffer.byteLength(args.content, 'utf-8')
  return `Wrote ${byteLen} bytes (${lineCount} lines) to ${args.path}`
}

// ═══════════════════════════════════════════════════
// Tool exports
// ═══════════════════════════════════════════════════

export const readFileTool: ToolDef<typeof ReadFileArgs> = {
  name: 'read_file',
  description: 'Read a file from the workspace. For long files, returns a head+tail preview.',
  parameters: ReadFileArgs,
  handler: readFile,
}

export const writeFileTool: ToolDef<typeof WriteFileArgs> = {
  name: 'write_file',
  description: 'Create or overwrite a file in the workspace. Requires user confirmation.',
  parameters: WriteFileArgs,
  handler: writeFile,
  requiresConfirm: true,
}
