import { z } from 'zod'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { ToolDef } from './index.js'
import {
  resolvePath,
  isInsideWorkspace,
  isBlocked,
  shouldSkipDir,
  isLikelyBinary,
} from './shared.js'

// ═══════════════════════════════════════════════════
// search_files — find by FILE NAME
// ═══════════════════════════════════════════════════

export const SearchFilesArgs = z.object({
  pattern: z.string().describe('Substring or regex to match against filenames'),
  path: z.string().optional().describe('Search root directory'),
})

type SearchFilesArgs = z.infer<typeof SearchFilesArgs>

async function walkSearchFiles(
  absDir: string,
  baseRel: string,
  pattern: string,
  isRegex: boolean,
  results: string[]
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (shouldSkipDir(entry.name)) continue

    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name

    // Check filename match
    const match = isRegex
      ? new RegExp(pattern, 'i').test(entry.name)
      : entry.name.toLowerCase().includes(pattern.toLowerCase())

    if (match) {
      results.push(relPath)
    }

    if (entry.isDirectory()) {
      await walkSearchFiles(path.join(absDir, entry.name), relPath, pattern, isRegex, results)
    }
  }
}

async function searchFiles(args: SearchFilesArgs): Promise<string> {
  const target = resolvePath(args.path ?? '.')

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path ?? '.'}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path ?? '.'}' is blocked`
  }

  // Simple heuristic: if pattern contains regex special chars, treat as regex
  const isRegex = /[.*+?^${}()|[\]\\]/.test(args.pattern)

  const results: string[] = []
  await walkSearchFiles(target, '', args.pattern, isRegex, results)

  if (results.length === 0) {
    return `No files matching '${args.pattern}'`
  }

  return results.join('\n')
}

// ═══════════════════════════════════════════════════
// search_content — grep file CONTENTS
// ═══════════════════════════════════════════════════

export const SearchContentArgs = z.object({
  pattern: z.string().describe('Substring or regex to search in file contents'),
  path: z.string().optional().describe('Search root directory'),
  glob: z.string().optional().describe('Optional filename filter (glob pattern)'),
  caseSensitive: z.boolean().default(false).describe('Case-sensitive search'),
  context: z.number().int().min(0).max(20).default(0).describe('Context lines around each match'),
})

type SearchContentArgs = z.infer<typeof SearchContentArgs>

/**
 * Minimal glob match for filename filtering (no ** support for the filter).
 */
function filenameMatches(name: string, globPattern: string): boolean {
  // Convert simple glob to regex
  let re = ''
  for (let i = 0; i < globPattern.length; i++) {
    const ch = globPattern[i]
    if (ch === '*') {
      re += '.*'
    } else if (ch === '?') {
      re += '.'
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += '\\' + ch
    } else {
      re += ch
    }
  }
  return new RegExp('^' + re + '$', 'i').test(name)
}

/**
 * Build a glob for the full relative path.
 */
function pathMatchesGlob(relPath: string, globPattern: string): boolean {
  if (!globPattern.includes('/')) {
    // Basename-only pattern
    return filenameMatches(path.basename(relPath), globPattern)
  }
  // Path pattern — join with the relative path
  return filenameMatches(relPath, globPattern)
}

interface MatchResult {
  filePath: string
  line: number
  content: string
  contextBefore: string[]
  contextAfter: string[]
}

async function walkSearchContent(
  absDir: string,
  baseRel: string,
  pattern: string,
  isRegex: boolean,
  caseSensitive: boolean,
  filterGlob: string | undefined,
  contextLines: number,
  results: MatchResult[],
  fileResults: Map<string, number>
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (shouldSkipDir(entry.name) || entry.name.startsWith('.')) continue

    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      await walkSearchContent(
        path.join(absDir, entry.name),
        relPath,
        pattern,
        isRegex,
        caseSensitive,
        filterGlob,
        contextLines,
        results,
        fileResults
      )
      continue
    }

    // Apply glob filter
    if (filterGlob && !pathMatchesGlob(relPath, filterGlob)) {
      continue
    }

    // Per-file cap (30 matches max)
    const existingCount = fileResults.get(relPath) ?? 0
    if (existingCount >= 30) continue

    // Read file
    let content: Buffer
    try {
      content = await fs.readFile(path.join(absDir, entry.name))
    } catch {
      continue
    }

    // Skip binary files
    if (isLikelyBinary(content)) continue

    const text = content.toString('utf-8')
    const lines = text.split('\n')

    // Search
    const flags = caseSensitive ? 'g' : 'gi'
    const re = isRegex ? new RegExp(pattern, flags) : new RegExp(escapeRegex(pattern), flags)

    let lineMatches = 0
    for (let i = 0; i < lines.length; i++) {
      if (lineMatches >= 30) break

      if (re.test(lines[i])) {
        lineMatches++
        const match: MatchResult = {
          filePath: relPath,
          line: i + 1,
          content: lines[i].trimEnd(),
          contextBefore: [],
          contextAfter: [],
        }

        // Context lines
        if (contextLines > 0) {
          const startCtx = Math.max(0, i - contextLines)
          const endCtx = Math.min(lines.length - 1, i + contextLines)
          for (let c = startCtx; c <= endCtx; c++) {
            if (c < i)
              match.contextBefore.push(`${String(c + 1).padStart(4)}| ${lines[c].trimEnd()}`)
            if (c > i)
              match.contextAfter.push(`${String(c + 1).padStart(4)}| ${lines[c].trimEnd()}`)
          }
        }

        results.push(match)
        fileResults.set(relPath, (fileResults.get(relPath) ?? 0) + 1)
      }

      // Reset lastIndex for global regex
      re.lastIndex = 0
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function searchContent(args: SearchContentArgs): Promise<string> {
  const target = resolvePath(args.path ?? '.')

  if (!isInsideWorkspace(target)) {
    return `Error: path '${args.path ?? '.'}' escapes workspace`
  }
  if (isBlocked(target)) {
    return `Error: path '${args.path ?? '.'}' is blocked`
  }

  const isRegex = /[.*+?^${}()|[\]\\]/.test(args.pattern) || args.caseSensitive

  const results: MatchResult[] = []
  const fileResults = new Map<string, number>()

  await walkSearchContent(
    target,
    '',
    args.pattern,
    isRegex,
    args.caseSensitive,
    args.glob,
    args.context,
    results,
    fileResults
  )

  if (results.length === 0) {
    return `No matches found for '${args.pattern}'`
  }

  // Format results
  const lines: string[] = []
  let currentFile = ''

  for (const r of results) {
    if (r.filePath !== currentFile) {
      currentFile = r.filePath
      lines.push('')
      lines.push(currentFile + ':')
    }

    for (const ctx of r.contextBefore) {
      lines.push(`  ${ctx}`)
    }

    lines.push(`  ${String(r.line).padStart(4)}| ${r.content}`)

    for (const ctx of r.contextAfter) {
      lines.push(`  ${ctx}`)
    }
  }

  // Summary
  const fileCount = new Set(results.map((r) => r.filePath)).size
  lines.push('')
  lines.push(
    `(${results.length} match${results.length > 1 ? 'es' : ''} in ${fileCount} file${fileCount > 1 ? 's' : ''})`
  )

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════
// Tool exports
// ═══════════════════════════════════════════════════

export const searchFilesTool: ToolDef<typeof SearchFilesArgs> = {
  name: 'search_files',
  description:
    'Find files whose NAME matches a substring or regex pattern. Recursive, case-insensitive.',
  parameters: SearchFilesArgs,
  handler: searchFiles,
}

export const searchContentTool: ToolDef<typeof SearchContentArgs> = {
  name: 'search_content',
  description:
    'Search file CONTENTS for a substring or regex pattern. Supports context lines and filename filtering with glob.',
  parameters: SearchContentArgs,
  handler: searchContent,
}
