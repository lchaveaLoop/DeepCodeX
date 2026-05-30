import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface PackageManagerInfo {
  name: string
  version?: string
  source: 'packageManager' | 'lockfile' | 'inferred'
}

export interface RepositoryScript {
  name: string
  command: string
}

export interface GitRepositoryInfo {
  isRepository: boolean
  branch?: string
  dirty: boolean
  status: string
}

export interface RepositoryInfo {
  packageManager: PackageManagerInfo | null
  scripts: RepositoryScript[]
  workspaces: string[]
  keyFiles: string[]
  packageFiles: string[]
  git: GitRepositoryInfo
}

const KEY_FILE_CANDIDATES = [
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'vitest.config.ts',
  'vitest.config.js',
  'README.md',
  'REASONIX.md',
  'AGENTS.md',
]

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo'])

interface PackageJsonShape {
  packageManager?: unknown
  scripts?: unknown
  workspaces?: unknown
}

function readJsonFile<T>(filepath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8')) as T
  } catch {
    return null
  }
}

function parsePackageManager(value: unknown): PackageManagerInfo | null {
  if (typeof value !== 'string' || !value.trim()) return null

  const at = value.lastIndexOf('@')
  if (at > 0) {
    return {
      name: value.slice(0, at),
      version: value.slice(at + 1) || undefined,
      source: 'packageManager',
    }
  }

  return { name: value, source: 'packageManager' }
}

function detectPackageManager(
  root: string,
  pkg: PackageJsonShape | null
): PackageManagerInfo | null {
  const fromPackage = parsePackageManager(pkg?.packageManager)
  if (fromPackage) return fromPackage

  const lockfiles: Array<[string, string]> = [
    ['package-lock.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ]

  for (const [file, name] of lockfiles) {
    if (fs.existsSync(path.join(root, file))) {
      return { name, source: 'lockfile' }
    }
  }

  if (pkg) return { name: 'npm', source: 'inferred' }
  return null
}

function readScripts(pkg: PackageJsonShape | null): RepositoryScript[] {
  if (!pkg?.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts)) return []

  return Object.entries(pkg.scripts as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, command]) => ({ name, command }))
}

function readWorkspaces(pkg: PackageJsonShape | null): string[] {
  const workspaces = pkg?.workspaces
  if (Array.isArray(workspaces)) {
    return workspaces.filter((item): item is string => typeof item === 'string')
  }

  if (
    workspaces &&
    typeof workspaces === 'object' &&
    Array.isArray((workspaces as { packages?: unknown }).packages)
  ) {
    return (workspaces as { packages: unknown[] }).packages.filter(
      (item): item is string => typeof item === 'string'
    )
  }

  return []
}

function collectKeyFiles(root: string): string[] {
  return KEY_FILE_CANDIDATES.filter((file) => fs.existsSync(path.join(root, file)))
}

function collectPackageFiles(root: string): string[] {
  const results: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > 3 || results.length >= 50) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name === 'package.json') {
        results.push(path.relative(root, path.join(dir, entry.name)) || 'package.json')
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name), depth + 1)
    }
  }

  walk(root, 0)
  return results.sort((a, b) => a.localeCompare(b))
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function analyzeGit(root: string): GitRepositoryInfo {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { isRepository: false, dirty: false, status: '' }
  }

  const status = git(root, ['status', '--short', '--branch']) ?? ''
  const statusLines = status.split(/\r?\n/).filter(Boolean)
  const branchLine = statusLines.find((line) => line.startsWith('## '))
  const branch = git(root, ['branch', '--show-current']) || branchLine?.replace(/^##\s+/, '')

  return {
    isRepository: true,
    branch: branch || undefined,
    dirty: statusLines.some((line) => !line.startsWith('## ')),
    status,
  }
}

export function analyzeRepository(root: string): RepositoryInfo {
  const packageJsonPath = path.join(root, 'package.json')
  const pkg = readJsonFile<PackageJsonShape>(packageJsonPath)

  return {
    packageManager: detectPackageManager(root, pkg),
    scripts: readScripts(pkg),
    workspaces: readWorkspaces(pkg),
    keyFiles: collectKeyFiles(root),
    packageFiles: collectPackageFiles(root),
    git: analyzeGit(root),
  }
}
