import { z } from 'zod'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import path from 'node:path'
import type { ToolDef } from './index.js'
import { resolvePath, isInsideWorkspace, isBlocked, shouldSkipDir } from './shared.js'

// ═══════════════════════════════════════════════════
// list_directory
// ═══════════════════════════════════════════════════

export const ListDirectoryArgs = z.object({
  path: z.string().optional().describe('Directory path relative to workspace root'),
})

type ListDirectoryArgs = z.infer<typeof ListDirectoryArgs>

async function listDirectory(args: ListDirectoryArgs): Promise<string> {
  const target = resolvePath(args.path ?? '.')

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path ?? '.'}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path ?? '.'}' is blocked`
  }

  let entries: Dirent[]
  try {
    entries = await fs.readdir(target, { withFileTypes: true })
  } catch {
    return `Error: directory not found: ${args.path ?? '.'}`
  }

  // Sort: directories first, then files; both alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })

  const lines = entries.map((e) => e.name + (e.isDirectory() ? '/' : ''))
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// directory_tree
// ═══════════════════════════════════════════════════

export const DirectoryTreeArgs = z.object({
  path: z.string().optional().describe('Root directory path relative to workspace root'),
  maxDepth: z.number().int().min(0).max(5).default(2).describe('Max recursion depth'),
})

type DirectoryTreeArgs = z.infer<typeof DirectoryTreeArgs>

interface TreeNode {
  name: string
  isDir: boolean
  children?: TreeNode[]
  hidden?: boolean // true when subtree is collapsed due to size
}

async function readTree(
  absPath: string,
  currentDepth: number,
  maxDepth: number
): Promise<TreeNode[]> {
  if (currentDepth > maxDepth) return []

  let entries: Dirent[]
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true })
  } catch {
    return []
  }

  // Skip blocked directories at the name level
  const filtered = entries.filter((e) => !shouldSkipDir(e.name) && !e.name.startsWith('.'))

  // Sort: dirs first, then alpha
  filtered.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const results: TreeNode[] = []

  // If too many children, collapse
  if (filtered.length > 50 && currentDepth < maxDepth) {
    for (const e of filtered) {
      if (e.isDirectory()) {
        results.push({ name: e.name, isDir: true, hidden: true })
      } else {
        results.push({ name: e.name, isDir: false })
      }
    }
    return results
  }

  for (const e of filtered) {
    if (e.isDirectory() && currentDepth < maxDepth) {
      const children = await readTree(path.join(absPath, e.name), currentDepth + 1, maxDepth)
      results.push({ name: e.name, isDir: true, children })
    } else if (e.isDirectory()) {
      results.push({ name: e.name, isDir: true, children: [] })
    } else {
      results.push({ name: e.name, isDir: false })
    }
  }

  return results
}

function renderTree(nodes: TreeNode[], indent = ''): string[] {
  const lines: string[] = []
  for (let i = 0; i < nodes.length; i++) {
    const isLast = i === nodes.length - 1
    const prefix = isLast ? '└── ' : '├── '
    const node = nodes[i]
    const suffix = node.isDir ? '/' : ''

    if (node.hidden) {
      lines.push(`${indent}${prefix}${node.name}${suffix} ${'[N hidden]'}`)
      continue
    }

    lines.push(`${indent}${prefix}${node.name}${suffix}`)

    if (node.children && node.children.length > 0) {
      const childIndent = indent + (isLast ? '    ' : '│   ')
      lines.push(...renderTree(node.children, childIndent))
    }
  }
  return lines
}

async function directoryTree(args: DirectoryTreeArgs): Promise<string> {
  const target = resolvePath(args.path ?? '.')

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path ?? '.'}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path ?? '.'}' is blocked`
  }

  if (!existsSync(target)) {
    return `Error: directory not found: ${args.path ?? '.'}`
  }

  const stat = await fs.stat(target)
  if (!stat.isDirectory()) {
    return `(not a directory)`
  }

  const tree = await readTree(target, 0, args.maxDepth)
  const rendered = renderTree(tree)
  const rootLabel = args.path || '.'
  return `${rootLabel}/\n${rendered.join('\n')}`
}

// ═══════════════════════════════════════════════════
// glob
// ═══════════════════════════════════════════════════

export const GlobArgs = z.object({
  pattern: z.string().describe('Glob pattern (e.g. src/**/*.ts)'),
  path: z.string().optional().describe('Search root relative to workspace root'),
  sortBy: z.enum(['mtime', 'name']).default('mtime').describe('Sort order'),
  limit: z.number().int().min(1).max(1000).default(200).describe('Max results'),
})

type GlobArgs = z.infer<typeof GlobArgs>

/**
 * Convert a glob pattern segment into a regex.
 * Handles *, **, ?, {a,b} — does NOT handle [...].
 */
function segmentToRegex(segment: string): string {
  let re = ''
  let i = 0
  while (i < segment.length) {
    const ch = segment[i]
    if (ch === '*') {
      if (i + 1 < segment.length && segment[i + 1] === '*') {
        re += '.*'
        i += 2
      } else {
        re += '[^/]*'
        i += 1
      }
    } else if (ch === '?') {
      re += '[^/]'
      i += 1
    } else if (ch === '{') {
      const end = segment.indexOf('}', i)
      if (end > i) {
        const alts = segment
          .slice(i + 1, end)
          .split(',')
          .map((a) => a.trim())
        const inner = alts.map((a) => segmentToRegex(a)).join('|')
        re += `(${inner})`
        i = end + 1
      } else {
        re += '\\{'
        i += 1
      }
    } else if (/[.+^${}()|[\\]/.test(ch)) {
      re += '\\' + ch
      i += 1
    } else {
      re += ch
      i += 1
    }
  }
  return re
}

function globToRegex(pattern: string): RegExp {
  const parts = pattern.split('/')
  const reParts = parts.map(segmentToRegex)
  return new RegExp('^' + reParts.join('/') + '$')
}

/**
 * Walk directory tree and collect files matching the glob pattern.
 */
async function walkGlob(
  absDir: string,
  baseRel: string,
  fileRegex: RegExp,
  results: Array<{ relPath: string; mtimeMs: number }>,
  limit: number
): Promise<void> {
  if (results.length >= limit) return

  let entries: Dirent[]
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (results.length >= limit) break
    if (shouldSkipDir(entry.name) || entry.name.startsWith('.')) continue

    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      // Always recurse — the regex match is applied at the full path level
      await walkGlob(path.join(absDir, entry.name), relPath, fileRegex, results, limit)
    } else if (fileRegex.test(relPath)) {
      try {
        const stat = await fs.stat(path.join(absDir, entry.name))
        results.push({ relPath, mtimeMs: stat.mtimeMs })
      } catch {
        // Skip files we can't stat
      }
    }
  }
}

async function globHandler(args: GlobArgs): Promise<string> {
  const target = resolvePath(args.path ?? '.')

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path ?? '.'}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path ?? '.'}' is blocked`
  }

  if (!existsSync(target)) {
    return `Error: path not found: ${args.path ?? '.'}`
  }

  let fileRegex: RegExp
  try {
    fileRegex = globToRegex(args.pattern)
  } catch {
    return `Error: invalid glob pattern '${args.pattern}'`
  }

  const results: Array<{ relPath: string; mtimeMs: number }> = []
  await walkGlob(target, '', fileRegex, results, args.limit)

  if (results.length === 0) {
    return `No files matching '${args.pattern}'`
  }

  // Sort
  if (args.sortBy === 'mtime') {
    results.sort((a, b) => b.mtimeMs - a.mtimeMs)
  } else {
    results.sort((a, b) => a.relPath.localeCompare(b.relPath))
  }

  const lines = results.map((r) => r.relPath)
  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// get_file_info
// ═══════════════════════════════════════════════════

export const GetFileInfoArgs = z.object({
  path: z.string().describe('Path relative to workspace root'),
})

type GetFileInfoArgs = z.infer<typeof GetFileInfoArgs>

async function getFileInfo(args: GetFileInfoArgs): Promise<string> {
  const target = resolvePath(args.path)

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path}' is blocked`
  }

  let stat: Stats
  try {
    stat = await fs.stat(target)
  } catch {
    return `Error: path not found: ${args.path}`
  }

  const type = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'symlink'
  const sizeKB = (stat.size / 1024).toFixed(1)
  const mtime = stat.mtime.toISOString()

  const parts: string[] = [
    `Type: ${type}`,
    `Size: ${stat.size} bytes (${sizeKB} KB)`,
    `Modified: ${mtime}`,
  ]

  if (stat.isDirectory()) {
    try {
      const entries = await fs.readdir(target)
      const fileCount = entries.filter((e) => !shouldSkipDir(e) && !e.startsWith('.')).length
      parts.push(`Entries: ${fileCount}`)
    } catch {
      // skip
    }
  }

  return parts.join('\n')
}

// ═══════════════════════════════════════════════════
// Tool exports
// ═══════════════════════════════════════════════════

export const listDirectoryTool: ToolDef<typeof ListDirectoryArgs> = {
  name: 'list_directory',
  description: 'List entries in a directory. Directories are marked with a trailing slash.',
  parameters: ListDirectoryArgs,
  handler: listDirectory,
}

export const directoryTreeTool: ToolDef<typeof DirectoryTreeArgs> = {
  name: 'directory_tree',
  description:
    'Recursively show a directory tree with indentation. Use for understanding project structure.',
  parameters: DirectoryTreeArgs,
  handler: directoryTree,
}

export const globTool: ToolDef<typeof GlobArgs> = {
  name: 'glob',
  description:
    'Find files matching a glob pattern. Supports **, *, ?, {a,b}. Results sorted by modification time by default.',
  parameters: GlobArgs,
  handler: globHandler,
}

export const getFileInfoTool: ToolDef<typeof GetFileInfoArgs> = {
  name: 'get_file_info',
  description: 'Get metadata about a file or directory: type, size, modification time.',
  parameters: GetFileInfoArgs,
  handler: getFileInfo,
}
