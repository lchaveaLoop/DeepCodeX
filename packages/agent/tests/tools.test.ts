import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { ToolRegistry, createRegistry } from '../src/tools/index.js'
import { readFileTool, writeFileTool, ReadFileArgs, WriteFileArgs } from '../src/tools/workspace.js'
import { assessCommandSafety, runCommandTool } from '../src/tools/shell.js'
import { WebSearchArgs } from '../src/tools/web-search.js'
import {
  listDirectoryTool,
  directoryTreeTool,
  globTool,
  getFileInfoTool,
  ListDirectoryArgs,
  DirectoryTreeArgs,
  GlobArgs,
  GetFileInfoArgs,
} from '../src/tools/filesystem.js'
import {
  searchFilesTool,
  searchContentTool,
  SearchFilesArgs,
  SearchContentArgs,
} from '../src/tools/search.js'
import { setWorkspaceRoot } from '../src/config.js'

let testRoot: string

beforeAll(async () => {
  testRoot = path.join(os.tmpdir(), `fagent-test-root-${Date.now()}`)
  await fs.mkdir(testRoot, { recursive: true })
  setWorkspaceRoot(testRoot)
})

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const reg = new ToolRegistry()
    reg.register(readFileTool)
    reg.register(writeFileTool)

    expect(reg.listNames()).toContain('read_file')
    expect(reg.listNames()).toContain('write_file')
    expect(reg.listNames().length).toBe(2)
  })

  it('returns error for unknown tool', async () => {
    const reg = new ToolRegistry()
    const result = await reg.execute('nonexistent', {})
    expect(result).toContain('Error')
  })

  it('returns structured success and failure results', async () => {
    const reg = new ToolRegistry()
    reg.register(readFileTool)

    await fs.writeFile(path.join(testRoot, 'structured.txt'), 'hello')

    const success = await reg.executeDetailed('read_file', { path: 'structured.txt' })
    expect(success).toMatchObject({
      ok: true,
      toolName: 'read_file',
      content: expect.stringContaining('hello'),
    })
    expect(success.duration).toEqual(expect.any(Number))

    const failure = await reg.executeDetailed('read_file', { path: '../outside.txt' })
    expect(failure).toMatchObject({
      ok: false,
      toolName: 'read_file',
      error: expect.stringContaining('escapes workspace'),
      content: expect.stringContaining('escapes workspace'),
    })
  })
})

describe('read_file', () => {
  it('reads file content', async () => {
    await fs.writeFile(path.join(testRoot, 'hello.ts'), 'const x = 1;\nconst y = 2;\n')

    const result = await readFileTool.handler({ path: 'hello.ts' })
    expect(result).toContain('const x = 1')
    expect(result).toContain('const y = 2')
  })

  it('handles line range', async () => {
    await fs.writeFile(path.join(testRoot, 'nums.txt'), 'one\ntwo\nthree\nfour\nfive\n')

    const result = await readFileTool.handler({ path: 'nums.txt', startLine: 2, endLine: 4 })
    expect(result).toContain('two')
    expect(result).toContain('four')
    expect(result).not.toContain('one')
  })

  it('rejects escape attempts', async () => {
    const result = await readFileTool.handler({ path: '../../../etc/passwd' })
    expect(result).toContain('escapes workspace')
  })

  it('rejects missing file', async () => {
    const result = await readFileTool.handler({ path: 'no.txt' })
    expect(result).toContain('file not found')
  })
})

describe('write_file', () => {
  it('writes and reports byte count', async () => {
    const result = await writeFileTool.handler({ path: 'out.txt', content: 'hello world' })
    expect(result).toContain('Wrote')
    expect(result).toContain('out.txt')

    const written = await fs.readFile(path.join(testRoot, 'out.txt'), 'utf-8')
    expect(written).toBe('hello world')
  })

  it('rejects escape', async () => {
    const result = await writeFileTool.handler({ path: '../out.txt', content: 'x' })
    expect(result).toContain('escapes workspace')
  })
})

describe('run_command', () => {
  it('executes a simple command', async () => {
    const result = runCommandTool.handler({ command: 'echo hello' })
    expect(result).toContain('hello')
  })

  it('executes commands from the configured workspace root', async () => {
    const root = path.join(os.tmpdir(), `fagent-command-cwd-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })

    try {
      setWorkspaceRoot(root)
      const result = await runCommandTool.handler({
        command: 'node -e "console.log(process.cwd())"',
      })

      expect(path.resolve(result.trim())).toBe(path.resolve(root))
    } finally {
      setWorkspaceRoot(testRoot)
    }
  })

  it('classifies command safety before execution', () => {
    expect(assessCommandSafety('git status --short')).toMatchObject({
      risk: 'low',
      blocked: false,
    })

    expect(assessCommandSafety('rm -rf dist')).toMatchObject({
      risk: 'high',
      blocked: false,
      requiresConfirmation: true,
    })

    expect(assessCommandSafety('git reset --hard --help')).toMatchObject({
      risk: 'blocked',
      blocked: true,
      requiresConfirmation: false,
    })
  })

  it('blocks forbidden commands before execution', async () => {
    const result = await runCommandTool.handler({ command: 'git reset --hard --help' })
    expect(result).toContain('Error: command blocked by safety policy')
    expect(result).toContain('git reset --hard')
  })
})

describe('web_search', () => {
  it('validates args with Zod', () => {
    const parsed = WebSearchArgs.safeParse({ query: 'test', topK: 3 })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.topK).toBe(3)
    }
  })

  it('rejects missing query', () => {
    const parsed = WebSearchArgs.safeParse({})
    expect(parsed.success).toBe(false)
  })
})

describe('Zod validation', () => {
  it('ReadFileArgs rejects non-string path', () => {
    const r = ReadFileArgs.safeParse({ path: 123 })
    expect(r.success).toBe(false)
  })

  it('WriteFileArgs requires content', () => {
    const r = WriteFileArgs.safeParse({ path: 'x' })
    expect(r.success).toBe(false)
  })

  it('ListDirectoryArgs accepts optional path', () => {
    const r = ListDirectoryArgs.safeParse({})
    expect(r.success).toBe(true)
  })

  it('DirectoryTreeArgs defaults maxDepth to 2', () => {
    const r = DirectoryTreeArgs.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.maxDepth).toBe(2)
  })

  it('GlobArgs enforces limit range', () => {
    const r = GlobArgs.safeParse({ pattern: '*.ts', limit: 2000 })
    expect(r.success).toBe(false)
  })

  it('SearchContentArgs has sensible defaults', () => {
    const r = SearchContentArgs.safeParse({ pattern: 'test' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.caseSensitive).toBe(false)
      expect(r.data.context).toBe(0)
    }
  })

  it('SearchFilesArgs requires pattern', () => {
    const r = SearchFilesArgs.safeParse({})
    expect(r.success).toBe(false)
  })
})

// ── New filesystem tools ──

describe('list_directory', () => {
  it('lists entries with dirs marked', async () => {
    await fs.mkdir(path.join(testRoot, 'subdir'), { recursive: true })
    await fs.writeFile(path.join(testRoot, 'a.txt'), 'a')

    const result = await listDirectoryTool.handler({ path: '.' })
    expect(result).toContain('subdir/')
    expect(result).toContain('a.txt')
  })

  it('rejects escape path', async () => {
    const result = await listDirectoryTool.handler({ path: '../../../etc' })
    expect(result).toContain('escapes workspace')
  })
})

describe('directory_tree', () => {
  it('shows tree structure', async () => {
    await fs.mkdir(path.join(testRoot, 'tree-a', 'tree-b'), { recursive: true })
    await fs.writeFile(path.join(testRoot, 'tree-a', 'leaf.ts'), 'x')

    const result = await directoryTreeTool.handler({ path: '.', maxDepth: 3 })
    expect(result).toContain('tree-a/')
    expect(result).toContain('tree-b/')
    expect(result).toContain('leaf.ts')
  })

  it('reports non-directory path', async () => {
    await fs.writeFile(path.join(testRoot, 'plain.txt'), 'data')

    const result = await directoryTreeTool.handler({ path: 'plain.txt' })
    expect(result).toContain('not a directory')
  })
})

describe('glob', () => {
  beforeAll(async () => {
    await fs.writeFile(path.join(testRoot, 'a.ts'), '// a')
    await fs.writeFile(path.join(testRoot, 'b.ts'), '// b')
    await fs.writeFile(path.join(testRoot, 'c.json'), '{}')
    await fs.mkdir(path.join(testRoot, 'nested'), { recursive: true })
    await fs.writeFile(path.join(testRoot, 'nested', 'd.ts'), '// d')
  })

  it('finds all .ts files', async () => {
    const result = await globTool.handler({ pattern: '*.ts', sortBy: 'name' })
    const lines = result.split('\n')
    expect(lines).toContain('a.ts')
    expect(lines).toContain('b.ts')
    expect(lines).not.toContain('c.json')
  })

  it('finds nested files with **', async () => {
    const result = await globTool.handler({ pattern: '**/*.ts', sortBy: 'name' })
    expect(result).toContain('nested/d.ts')
  })

  it('respects limit', async () => {
    const result = await globTool.handler({ pattern: '*', limit: 1 })
    const lines = result.split('\n')
    expect(lines.length).toBe(1)
  })

  it('handles patterns with no matches gracefully', async () => {
    const result = await globTool.handler({ pattern: '*.nonexistent' })
    expect(result).toContain('No files matching')
  })
})

describe('get_file_info', () => {
  it('returns type and size for file', async () => {
    await fs.writeFile(path.join(testRoot, 'info.txt'), 'hello')

    const result = await getFileInfoTool.handler({ path: 'info.txt' })
    expect(result).toContain('Type: file')
    expect(result).toContain('bytes')
    expect(result).toContain('Modified:')
  })

  it('returns directory info with entry count', async () => {
    await fs.mkdir(path.join(testRoot, 'infodir'), { recursive: true })
    await fs.writeFile(path.join(testRoot, 'infodir', 'x.ts'), 'x')

    const result = await getFileInfoTool.handler({ path: 'infodir' })
    expect(result).toContain('Type: directory')
    expect(result).toContain('Entries:')
  })
})

// ── New search tools ──

describe('search_files', () => {
  beforeAll(async () => {
    await fs.writeFile(path.join(testRoot, 'main.ts'), '')
    await fs.writeFile(path.join(testRoot, 'main.test.ts'), '')
    await fs.writeFile(path.join(testRoot, 'helper.js'), '')
  })

  it('finds files by substring (case-insensitive)', async () => {
    const result = await searchFilesTool.handler({ pattern: 'MAIN' })
    expect(result).toContain('main.ts')
    expect(result).toContain('main.test.ts')
  })

  it('returns nothing for no match', async () => {
    const result = await searchFilesTool.handler({ pattern: 'zzz_nonexistent_zzz' })
    expect(result).toContain('No files matching')
  })
})

describe('search_content', () => {
  beforeAll(async () => {
    await fs.writeFile(path.join(testRoot, 'greeting.txt'), 'hello world\nhow are you\nhello again')
    await fs.writeFile(path.join(testRoot, 'data.txt'), 'nothing here\nbut hello world\nand more')
  })

  it('finds matches across files', async () => {
    const result = await searchContentTool.handler({ pattern: 'hello' })
    expect(result).toContain('greeting.txt')
    expect(result).toContain('data.txt')
    expect(result).toContain('hello world')
    expect(result).toContain('hello again')
  })

  it('includes context lines', async () => {
    const result = await searchContentTool.handler({ pattern: 'how are you', context: 1 })
    expect(result).toContain('hello world')
    expect(result).toContain('hello again')
  })

  it('filters by glob', async () => {
    const result = await searchContentTool.handler({
      pattern: 'hello',
      glob: 'data.txt',
    })
    expect(result).toContain('data.txt')
    expect(result).not.toContain('greeting.txt')
  })
})

// ── createRegistry integration ──

describe('createRegistry', () => {
  it('registers all 10 tools', () => {
    const reg = createRegistry()
    const names = reg.listNames().sort()
    expect(names).toEqual([
      'directory_tree',
      'get_file_info',
      'glob',
      'list_directory',
      'read_file',
      'run_command',
      'search_content',
      'search_files',
      'web_search',
      'write_file',
    ])
  })
})
