import path from 'node:path'
import { getWorkspaceRoot, BLOCKED_PATH_NAMES } from '../config.js'

// ═══════════════════════════════════════════════════
// File system helpers
// ═══════════════════════════════════════════════════

export function resolvePath(filePath: string): string {
  return path.resolve(getWorkspaceRoot(), filePath)
}

export function isInsideWorkspace(absPath: string): boolean {
  const root = getWorkspaceRoot()
  const rel = path.relative(root, absPath)
  return !rel.startsWith('..') && !path.isAbsolute(rel)
}

export function isBlocked(absPath: string): boolean {
  const parts = absPath.split(path.sep)
  return parts.some((p) => BLOCKED_PATH_NAMES.has(p))
}

/** Check if a directory name should be skipped during recursive walks. */
export function shouldSkipDir(dirName: string): boolean {
  return BLOCKED_PATH_NAMES.has(dirName)
}

/** Check if a path string is likely a binary file (null bytes or known binary extensions). */
export function isLikelyBinary(content: Buffer): boolean {
  // Check for null bytes in the first 8 KiB
  const checkLen = Math.min(content.length, 8192)
  for (let i = 0; i < checkLen; i++) {
    if (content[i] === 0) return true
  }
  return false
}
