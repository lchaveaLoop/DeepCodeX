import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { z } from 'zod'

// ── vi.mock hoisting: use vi.hoisted() for the mock ref ──
const { mockStream } = vi.hoisted(() => ({ mockStream: vi.fn() }))

vi.mock('../src/llm.js', () => ({
  streamAndAccumulate: mockStream,
}))

import { ToolRegistry, type ToolDef } from '../src/tools/index.js'
import { readFileTool, writeFileTool } from '../src/tools/workspace.js'
import { runCommandTool } from '../src/tools/shell.js'
import { setWorkspaceRoot } from '../src/config.js'
import type { StreamedResponse, ToolCall } from '../src/llm.js'

import { Agent } from '../src/agent.js'
import { saveSession, loadSession } from '../src/session.js'
import type { LLMProvider, LLMResponse } from '../src/providers/llm-provider.js'

function makeResp(
  content = '',
  toolCalls: ToolCall[] = [],
  reasoning: string | null = null
): StreamedResponse {
  return { content, toolCalls, reasoning }
}

function makeTC(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: args }
}

function makeProvider(
  chatResponses: LLMResponse[],
  streamResponses: StreamedResponse[]
): LLMProvider {
  return {
    model: 'test-model',
    chat: vi.fn(
      async () => chatResponses.shift() ?? { content: '', reasoning: null, toolCalls: [] }
    ),
    stream: vi.fn(async () => streamResponses.shift() ?? makeResp('')),
  }
}

describe('Agent loop', () => {
  beforeEach(() => {
    mockStream.mockReset()
  })

  it('direct answer no tools', async () => {
    mockStream.mockResolvedValueOnce(makeResp('Hello, world!'))

    const agent = new Agent(new ToolRegistry())
    const result = await agent.run('Hi!')

    expect(result).toBe('Hello, world!')
    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(agent.currentRun?.status).toBe('completed')
    expect(agent.currentRun?.output).toBe('Hello, world!')
    expect(agent.currentRun?.steps.map((s) => s.kind)).toEqual([
      'user_message',
      'round_start',
      'llm_request',
      'llm_response',
      'assistant_message',
      'final',
    ])
  })

  it('single round tool call', async () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)

    const root = path.join(os.tmpdir(), `fagent-agent-test-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'x.py'), "print('hi')")
    setWorkspaceRoot(root)

    mockStream
      .mockResolvedValueOnce(makeResp('', [makeTC('c1', 'read_file', { path: 'x.py' })]))
      .mockResolvedValueOnce(makeResp("File contains: print('hi')"))

    const agent = new Agent(registry)
    const result = await agent.run('Read x.py')

    expect(result).toBe("File contains: print('hi')")
    expect(mockStream).toHaveBeenCalledTimes(2)
    expect(agent.currentRun?.status).toBe('completed')
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain('tool_call')
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain('tool_result')
    expect(agent.currentRun?.steps.find((s) => s.kind === 'tool_call')).toMatchObject({
      toolCallId: 'c1',
      toolName: 'read_file',
      round: 1,
    })
    expect(agent.currentRun?.steps.find((s) => s.kind === 'tool_result')?.data).toMatchObject({
      result: expect.stringContaining("print('hi')"),
      ok: true,
      content: expect.stringContaining("print('hi')"),
      duration: expect.any(Number),
    })
    expect(agent.currentRun?.workspaceChanges).toMatchObject({
      changed: false,
      changes: [],
    })
  })

  it('records structured tool failure data without relying on thrown exceptions', async () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)

    const root = path.join(os.tmpdir(), `fagent-tool-error-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    setWorkspaceRoot(root)

    mockStream
      .mockResolvedValueOnce(makeResp('', [makeTC('c1', 'read_file', { path: '../x.txt' })]))
      .mockResolvedValueOnce(makeResp('Recovered.'))

    const agent = new Agent(registry)
    await agent.run('Read outside file')

    const toolResult = agent.currentRun?.steps.find((s) => s.kind === 'tool_result')
    expect(toolResult?.data).toMatchObject({
      ok: false,
      error: expect.stringContaining('escapes workspace'),
      content: expect.stringContaining('escapes workspace'),
    })
  })

  it('multi round tool calls', async () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)

    const root = path.join(os.tmpdir(), `fagent-multi-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'a.py'), 'a')
    await fs.writeFile(path.join(root, 'b.py'), 'b')
    setWorkspaceRoot(root)

    mockStream
      .mockResolvedValueOnce(makeResp('', [makeTC('c1', 'read_file', { path: 'a.py' })]))
      .mockResolvedValueOnce(makeResp('', [makeTC('c2', 'read_file', { path: 'b.py' })]))
      .mockResolvedValueOnce(makeResp('Done.'))

    const agent = new Agent(registry)
    const result = await agent.run('Read files')

    expect(result).toBe('Done.')
    expect(mockStream).toHaveBeenCalledTimes(3)
  })

  it('rejects unknown tool gracefully', async () => {
    mockStream
      .mockResolvedValueOnce(makeResp('', [makeTC('c1', 'nonexistent', {})]))
      .mockResolvedValueOnce(makeResp('Recovered.'))

    const agent = new Agent(new ToolRegistry())
    const result = await agent.run('X')

    expect(result).toBe('Recovered.')
  })

  it('max rounds enforced', async () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)

    const root = path.join(os.tmpdir(), `fagent-max-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'x'), 'data')
    setWorkspaceRoot(root)

    const config = await import('../src/config.js')

    // Always return tool_calls — will loop until max
    mockStream.mockResolvedValue(makeResp('', [makeTC('c1', 'read_file', { path: 'x' })]))

    const agent = new Agent(registry)
    const result = await agent.run('Loop')

    expect(result.toLowerCase()).toContain('maximum')
    expect(mockStream.mock.calls.length).toBe(config.MAX_TOOL_ROUNDS)
    expect(agent.currentRun?.status).toBe('max_rounds')
    expect(agent.currentRun?.totalRounds).toBe(config.MAX_TOOL_ROUNDS)
    expect(agent.currentRun?.steps.at(-1)?.kind).toBe('max_rounds')
  })

  it('passes reasoning_content back in assistant message', async () => {
    mockStream.mockResolvedValueOnce(makeResp('The answer is 42.', [], 'Let me think...'))

    const agent = new Agent(new ToolRegistry())
    await agent.run('?')

    const assistantMsgs = agent.messageHistory.filter((m) => m.role === 'assistant')
    expect(assistantMsgs.length).toBe(1)
    expect((assistantMsgs[0] as any).reasoning_content).toBe('Let me think...')
  })

  it('confirms destructive tools via callback', async () => {
    const registry = new ToolRegistry()
    registry.register(writeFileTool)

    const root = path.join(os.tmpdir(), `fagent-confirm-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    setWorkspaceRoot(root)

    mockStream
      .mockResolvedValueOnce(
        makeResp('', [makeTC('c1', 'write_file', { path: 'out.txt', content: 'hi' })])
      )
      .mockResolvedValueOnce(makeResp('Done writing.'))

    let confirmCalled = false
    const callbacks = {
      onConfirm: async (name: string, _args: Record<string, unknown>) => {
        confirmCalled = true
        expect(name).toBe('write_file')
        return true
      },
    }

    const agent = new Agent(registry, callbacks)
    const result = await agent.run('Write out.txt')

    expect(result).toBe('Done writing.')
    expect(confirmCalled).toBe(true)

    const written = await fs.readFile(path.join(root, 'out.txt'), 'utf-8')
    expect(written).toBe('hi')
    expect(agent.currentRun?.workspaceChanges).toMatchObject({
      changed: true,
      changes: [
        expect.objectContaining({
          kind: 'file_write',
          sourceTool: 'write_file',
          target: 'out.txt',
          confidence: 'confirmed',
          toolCallId: 'c1',
        }),
      ],
    })
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain('workspace_change')
  })

  it('rejects destructive tools when callback denies', async () => {
    const registry = new ToolRegistry()
    registry.register(writeFileTool)

    const root = path.join(os.tmpdir(), `fagent-deny-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    setWorkspaceRoot(root)

    mockStream
      .mockResolvedValueOnce(
        makeResp('', [makeTC('c1', 'write_file', { path: 'x.txt', content: 'bad' })])
      )
      .mockResolvedValueOnce(makeResp("OK, I won't write that."))

    const callbacks = { onConfirm: async () => false }

    const agent = new Agent(registry, callbacks)
    const result = await agent.run('Write x.txt')

    expect(result).toBe("OK, I won't write that.")
    await expect(fs.access(path.join(root, 'x.txt'))).rejects.toThrow()
    expect(agent.currentRun?.steps.map((s) => s.kind)).toContain('tool_rejected')
  })

  it('blocks unsafe run_command before asking for confirmation', async () => {
    const registry = new ToolRegistry()
    registry.register(runCommandTool)

    mockStream
      .mockResolvedValueOnce(
        makeResp('', [makeTC('c1', 'run_command', { command: 'git reset --hard --help' })])
      )
      .mockResolvedValueOnce(makeResp('I will not run that.'))

    let confirmCalled = false
    const agent = new Agent(registry, {
      onConfirm: async () => {
        confirmCalled = true
        return false
      },
    })

    const result = await agent.run('Reset the repository')

    expect(result).toBe('I will not run that.')
    expect(confirmCalled).toBe(false)
    expect(agent.currentRun?.steps.find((s) => s.kind === 'tool_result')?.data).toMatchObject({
      ok: false,
      error: expect.stringContaining('blocked by safety policy'),
      execution: expect.objectContaining({ risk: 'blocked', blocked: true }),
    })
  })

  it('records verification results when run_command executes an inferred verification command', async () => {
    const root = path.join(os.tmpdir(), `fagent-verification-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo ok' } }, null, 2)
    )
    setWorkspaceRoot(root)

    const RunCommandArgs = z.object({ command: z.string() })
    const fakeRunCommandTool: ToolDef<typeof RunCommandArgs> = {
      name: 'run_command',
      description: 'fake command runner',
      parameters: RunCommandArgs,
      handler: () => 'tests passed',
      describeExecution: ({ command }) => ({
        summary: command,
        risk: 'low',
        blocked: false,
        requiresConfirmation: false,
        reasons: [],
      }),
    }

    const registry = new ToolRegistry()
    registry.register(fakeRunCommandTool)
    const provider = makeProvider(
      [],
      [makeResp('', [makeTC('c1', 'run_command', { command: 'npm run test' })]), makeResp('Done.')]
    )

    const agent = new Agent({ registry, provider, planning: { mode: 'off' } })
    await agent.run('verify changes')

    expect(agent.currentRun?.verification?.commands).toEqual([
      { name: 'test', command: 'npm run test', source: 'script', required: true },
    ])
    expect(agent.currentRun?.verification?.results).toEqual([
      expect.objectContaining({
        name: 'test',
        command: 'npm run test',
        ok: true,
        toolCallId: 'c1',
        round: 1,
      }),
    ])
    expect(
      agent.currentRun?.steps.find((step) => step.kind === 'verification_result')
    ).toMatchObject({
      toolCallId: 'c1',
      toolName: 'run_command',
      data: expect.objectContaining({ command: 'npm run test', ok: true }),
    })
  })

  it('records possible workspace changes from mutating shell commands', async () => {
    const root = path.join(os.tmpdir(), `fagent-command-change-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    setWorkspaceRoot(root)

    const RunCommandArgs = z.object({ command: z.string() })
    const fakeRunCommandTool: ToolDef<typeof RunCommandArgs> = {
      name: 'run_command',
      description: 'fake command runner',
      parameters: RunCommandArgs,
      handler: () => 'installed',
      describeExecution: ({ command }) => ({
        summary: command,
        risk: 'medium',
        blocked: false,
        requiresConfirmation: true,
        reasons: ['command may change files, dependencies, or repository state'],
      }),
    }

    const registry = new ToolRegistry()
    registry.register(fakeRunCommandTool)
    const provider = makeProvider(
      [],
      [
        makeResp('', [makeTC('c1', 'run_command', { command: 'npm install left-pad' })]),
        makeResp('Done.'),
      ]
    )

    const agent = new Agent({ registry, provider, planning: { mode: 'off' } })
    await agent.run('install dependency')

    expect(agent.currentRun?.workspaceChanges).toMatchObject({
      changed: true,
      changes: [
        expect.objectContaining({
          kind: 'command',
          sourceTool: 'run_command',
          command: 'npm install left-pad',
          confidence: 'possible',
          toolCallId: 'c1',
        }),
      ],
    })
  })

  it('injects required verification commands into each model round', async () => {
    const root = path.join(os.tmpdir(), `fagent-verification-context-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo test', build: 'echo build' } }, null, 2)
    )
    setWorkspaceRoot(root)

    const provider = makeProvider([], [makeResp('Done without verification.')])
    const agent = new Agent({
      registry: new ToolRegistry(),
      provider,
      planning: { mode: 'off' },
    })

    await agent.run('make a small change')

    const streamCalls = (provider.stream as unknown as ReturnType<typeof vi.fn>).mock.calls
    const messages = streamCalls[0][0]
    const contextMessage = messages.find(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('Required verification commands')
    )

    expect(String(contextMessage?.content)).toContain('npm run test')
    expect(String(contextMessage?.content)).toContain('npm run build')
    expect(String(contextMessage?.content)).toContain('Run required verification before final')
  })

  it('continues instead of finalizing when workspace changes still need verification', async () => {
    const root = path.join(os.tmpdir(), `fagent-verification-guard-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo test' } }, null, 2)
    )
    setWorkspaceRoot(root)

    const RunCommandArgs = z.object({ command: z.string() })
    const fakeRunCommandTool: ToolDef<typeof RunCommandArgs> = {
      name: 'run_command',
      description: 'fake command runner',
      parameters: RunCommandArgs,
      handler: () => 'tests passed',
      describeExecution: ({ command }) => ({
        summary: command,
        risk: 'low',
        blocked: false,
        requiresConfirmation: false,
        reasons: [],
      }),
    }

    const registry = new ToolRegistry()
    registry.register(writeFileTool)
    registry.register(fakeRunCommandTool)
    const provider = makeProvider(
      [],
      [
        makeResp('', [makeTC('c1', 'write_file', { path: 'x.txt', content: 'changed' })]),
        makeResp('Done without tests.'),
        makeResp('', [makeTC('c2', 'run_command', { command: 'npm run test' })]),
        makeResp('Verified.'),
      ]
    )

    const agent = new Agent({
      registry,
      provider,
      planning: { mode: 'off' },
      callbacks: { onConfirm: async () => true },
    })
    const result = await agent.run('write and verify x.txt')

    expect(result).toBe('Verified.')
    expect(provider.stream).toHaveBeenCalledTimes(4)
    expect(agent.currentRun?.steps.map((step) => step.kind)).toContain('verification_required')
    expect(agent.currentRun?.verification?.results).toEqual([
      expect.objectContaining({ command: 'npm run test', status: 'passed' }),
    ])
  })

  it('keeps existing behavior when planning is off', async () => {
    const provider = makeProvider(
      [
        {
          content: '{"goal":"ignored","steps":[{"description":"ignored"}]}',
          reasoning: null,
          toolCalls: [],
        },
      ],
      [makeResp('No planning.')]
    )

    const agent = new Agent({
      registry: new ToolRegistry(),
      provider,
      planning: { mode: 'off' },
    })
    const result = await agent.run('implement a small change')

    expect(result).toBe('No planning.')
    expect(provider.chat).not.toHaveBeenCalled()
    expect(agent.currentPlan).toBeNull()
  })

  it('creates a plan in always mode before streaming the task', async () => {
    const provider = makeProvider(
      [
        {
          content:
            '{"goal":"Implement feature","steps":[{"description":"Inspect code"},{"description":"Edit code"}]}',
          reasoning: null,
          toolCalls: [],
        },
      ],
      [makeResp('Planned answer.')]
    )

    const planUpdates: unknown[] = []
    const agent = new Agent({
      registry: new ToolRegistry(),
      provider,
      planning: { mode: 'always' },
      callbacks: { onPlanUpdate: (plan) => planUpdates.push(plan) },
    })

    const result = await agent.run('implement a feature')

    expect(result).toBe('Planned answer.')
    expect(provider.chat).toHaveBeenCalledTimes(1)
    expect(provider.stream).toHaveBeenCalledTimes(1)
    expect(agent.currentPlan?.goal).toBe('Implement feature')
    expect(agent.currentPlan?.steps[0].status).toBe('done')
    expect(planUpdates.length).toBeGreaterThan(0)
  })

  it('falls back to normal execution when plan JSON is invalid', async () => {
    const provider = makeProvider(
      [{ content: 'not json', reasoning: null, toolCalls: [] }],
      [makeResp('Recovered without plan.')]
    )

    const agent = new Agent({
      registry: new ToolRegistry(),
      provider,
      planning: { mode: 'always' },
    })

    const result = await agent.run('implement a feature')

    expect(result).toBe('Recovered without plan.')
    expect(agent.currentPlan).toBeNull()
  })

  it('marks the current plan step done after a successful tool result', async () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)
    const root = path.join(os.tmpdir(), `fagent-plan-tool-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'x.txt'), 'hello')
    setWorkspaceRoot(root)

    const provider = makeProvider(
      [
        {
          content:
            '{"goal":"Read file","steps":[{"description":"Read x.txt"},{"description":"Summarize"}]}',
          reasoning: null,
          toolCalls: [],
        },
      ],
      [makeResp('', [makeTC('c1', 'read_file', { path: 'x.txt' })]), makeResp('Done.')]
    )

    const agent = new Agent({ registry, provider, planning: { mode: 'always' } })
    await agent.run('read and summarize x.txt')

    expect(agent.currentPlan?.steps[0].status).toBe('done')
    expect(agent.currentPlan?.steps[1].status).toBe('done')
  })

  it('marks the current plan step blocked when a destructive tool is rejected', async () => {
    const registry = new ToolRegistry()
    registry.register(writeFileTool)

    const provider = makeProvider(
      [
        {
          content: '{"goal":"Write file","steps":[{"description":"Write x.txt"}]}',
          reasoning: null,
          toolCalls: [],
        },
      ],
      [
        makeResp('', [makeTC('c1', 'write_file', { path: 'x.txt', content: 'bad' })]),
        makeResp('Not writing.'),
      ]
    )

    const agent = new Agent({
      registry,
      provider,
      planning: { mode: 'always' },
      callbacks: { onConfirm: async () => false },
    })
    await agent.run('write x.txt')

    expect(agent.currentPlan?.status).toBe('blocked')
    expect(agent.currentPlan?.steps[0].status).toBe('blocked')
  })

  it('keeps unfinished plan state when max rounds is reached', async () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)
    const root = path.join(os.tmpdir(), `fagent-plan-max-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'x'), 'data')
    setWorkspaceRoot(root)

    const provider = makeProvider(
      [
        {
          content: '{"goal":"Loop","steps":[{"description":"Read repeatedly"}]}',
          reasoning: null,
          toolCalls: [],
        },
      ],
      [
        makeResp('', [makeTC('c1', 'read_file', { path: 'x' })]),
        makeResp('', [makeTC('c2', 'read_file', { path: 'x' })]),
      ]
    )

    const agent = new Agent({ registry, provider, maxRounds: 2, planning: { mode: 'always' } })
    const result = await agent.run('loop over x')

    expect(result.toLowerCase()).toContain('maximum')
    expect(agent.currentPlan?.status).toBe('failed')
  })
})

describe('Session persistence', () => {
  it('roundtrips save and load', async () => {
    const dir = path.join(os.tmpdir(), `fagent-session-${Date.now()}`)
    await fs.mkdir(dir, { recursive: true })
    const filepath = path.join(dir, 'session.json')

    const msgs = [
      { role: 'system', content: 'Hello' },
      { role: 'user', content: 'Hi' },
    ]

    await saveSession(msgs, filepath)
    const loaded = await loadSession(filepath)
    expect(loaded).toEqual(msgs)
  })
})
