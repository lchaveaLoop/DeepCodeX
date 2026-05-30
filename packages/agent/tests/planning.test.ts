import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setWorkspaceRoot } from '../src/config.js'
import {
  analyzeRepository,
  buildAgentContext,
  createPlanDraft,
  inferVerificationCommands,
  TaskManager,
} from '../src/planning/index.js'
import { ToolRegistry } from '../src/tools/index.js'
import { readFileTool, writeFileTool } from '../src/tools/workspace.js'
import type { LLMProvider } from '../src/providers/llm-provider.js'

const provider: LLMProvider = {
  model: 'test-model',
  chat: async () => ({ content: '', reasoning: null, toolCalls: [] }),
  stream: async () => ({ content: '', reasoning: null, toolCalls: [] }),
}

describe('TaskManager', () => {
  it('creates a plan with stable step ids and starts the first step', () => {
    const manager = new TaskManager()

    const plan = manager.createPlan({
      goal: 'Update docs',
      steps: [{ description: 'Read docs' }, { description: 'Patch docs' }],
    })

    expect(plan.status).toBe('running')
    expect(plan.steps.map((step) => step.id)).toEqual(['plan_step_1', 'plan_step_2'])
    expect(plan.steps.map((step) => step.status)).toEqual(['in_progress', 'pending'])
    expect(manager.currentStep?.description).toBe('Read docs')
  })

  it('completes, fails, blocks, and clears the current step', () => {
    const manager = new TaskManager()
    manager.createPlan({
      goal: 'Change code',
      steps: [{ description: 'Write file' }, { description: 'Run test' }],
    })

    manager.completeCurrentStep('Wrote file')
    expect(manager.currentPlan?.steps[0]).toMatchObject({ status: 'done', result: 'Wrote file' })
    expect(manager.currentStep?.description).toBe('Run test')

    manager.failCurrentStep('Test failed')
    expect(manager.currentPlan?.status).toBe('failed')
    expect(manager.currentPlan?.steps[1]).toMatchObject({ status: 'failed', result: 'Test failed' })

    manager.clearPlan()
    expect(manager.currentPlan).toBeNull()
  })

  it('marks the current step as blocked', () => {
    const manager = new TaskManager()
    manager.createPlan({ goal: 'Dangerous change', steps: [{ description: 'Write file' }] })

    manager.blockCurrentStep('Rejected by user')

    expect(manager.currentPlan?.status).toBe('blocked')
    expect(manager.currentPlan?.steps[0]).toMatchObject({
      status: 'blocked',
      result: 'Rejected by user',
    })
  })

  it('formats a compact plan summary', () => {
    const manager = new TaskManager()
    manager.createPlan({ goal: 'Ship feature', steps: [{ description: 'Implement feature' }] })

    expect(manager.formatSummary()).toContain('Goal: Ship feature')
    expect(manager.formatSummary()).toContain('[in_progress] plan_step_1: Implement feature')
  })
})

describe('buildAgentContext', () => {
  it('captures tools, workspace, provider, and session context', () => {
    const registry = new ToolRegistry()
    registry.register(readFileTool)
    registry.register(writeFileTool)
    setWorkspaceRoot(path.resolve('.'))

    const context = buildAgentContext({
      registry,
      provider,
      messageCount: 3,
      hasLoadedHistory: true,
    })

    expect(context.tools.map((tool) => tool.name).sort()).toEqual(['read_file', 'write_file'])
    expect(context.tools.find((tool) => tool.name === 'write_file')?.requiresConfirm).toBe(true)
    expect(context.model.name).toBe('test-model')
    expect(context.session).toEqual({ messageCount: 3, hasLoadedHistory: true })
    expect(context.workspace.root).toBe(path.resolve('.'))
    expect(context.platform.os).toBe(process.platform)
  })

  it('captures repository package metadata and runnable scripts', async () => {
    const root = path.join(os.tmpdir(), `fagent-repo-context-${Date.now()}`)
    await fs.mkdir(path.join(root, 'packages', 'agent'), { recursive: true })
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          name: 'sample-workspace',
          packageManager: 'npm@10.9.2',
          workspaces: ['packages/agent'],
          scripts: {
            build: 'tsc',
            test: 'vitest run',
            lint: 'eslint src',
          },
        },
        null,
        2
      )
    )
    await fs.writeFile(path.join(root, 'package-lock.json'), '{}')
    await fs.writeFile(path.join(root, 'README.md'), '# Sample')
    await fs.writeFile(path.join(root, 'tsconfig.json'), '{}')
    await fs.writeFile(path.join(root, 'packages', 'agent', 'package.json'), '{"name":"agent"}')
    setWorkspaceRoot(root)

    const context = buildAgentContext({
      registry: new ToolRegistry(),
      provider,
      messageCount: 0,
      hasLoadedHistory: false,
    })

    expect(context.repository.packageManager).toEqual({
      name: 'npm',
      version: '10.9.2',
      source: 'packageManager',
    })
    expect(context.repository.scripts).toEqual([
      { name: 'build', command: 'tsc' },
      { name: 'lint', command: 'eslint src' },
      { name: 'test', command: 'vitest run' },
    ])
    expect(context.verification.commands).toEqual([
      { name: 'test', command: 'npm run test', source: 'script', required: true },
      { name: 'build', command: 'npm run build', source: 'script', required: true },
      { name: 'lint', command: 'npm run lint', source: 'script', required: true },
    ])
    expect(context.repository.workspaces).toEqual(['packages/agent'])
    expect(context.repository.keyFiles).toEqual(
      expect.arrayContaining(['package.json', 'package-lock.json', 'README.md', 'tsconfig.json'])
    )
    expect(context.repository.packageFiles).toEqual([
      'package.json',
      path.join('packages', 'agent', 'package.json'),
    ])
    expect(context.repository.git.isRepository).toBe(false)
  })
})

describe('inferVerificationCommands', () => {
  it('prioritizes standard package scripts using the detected package manager', () => {
    expect(
      inferVerificationCommands({
        packageManager: { name: 'pnpm', version: '9.0.0', source: 'packageManager' },
        scripts: [
          { name: 'dev', command: 'vite' },
          { name: 'lint', command: 'eslint src' },
          { name: 'test', command: 'vitest run' },
          { name: 'build', command: 'tsc' },
          { name: 'typecheck', command: 'tsc --noEmit' },
        ],
        workspaces: [],
        keyFiles: [],
        packageFiles: [],
        git: { isRepository: false, dirty: false, status: '' },
      })
    ).toEqual([
      { name: 'test', command: 'pnpm run test', source: 'script', required: true },
      { name: 'build', command: 'pnpm run build', source: 'script', required: true },
      { name: 'lint', command: 'pnpm run lint', source: 'script', required: true },
      {
        name: 'typecheck',
        command: 'pnpm run typecheck',
        source: 'script',
        required: false,
      },
    ])
  })
})

describe('analyzeRepository', () => {
  it('captures git repository status without throwing', async () => {
    const root = path.join(os.tmpdir(), `fagent-git-context-${Date.now()}`)
    await fs.mkdir(root, { recursive: true })
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' })
    await fs.writeFile(path.join(root, 'README.md'), '# Git repo')

    const repository = analyzeRepository(root)

    expect(repository.git.isRepository).toBe(true)
    expect(repository.git.status).toEqual(expect.any(String))
    expect(repository.git.dirty).toBe(true)
  })
})

describe('createPlanDraft', () => {
  it('includes repository intelligence in the planner prompt', async () => {
    let capturedMessages: Parameters<LLMProvider['chat']>[0] | null = null
    const planningProvider: LLMProvider = {
      model: 'planner-model',
      chat: async (messages) => {
        capturedMessages = messages
        return {
          content: '{"goal":"Run verification","steps":[{"description":"Run tests"}]}',
          reasoning: null,
          toolCalls: [],
        }
      },
      stream: async () => ({ content: '', reasoning: null, toolCalls: [] }),
    }

    const draft = await createPlanDraft({
      provider: planningProvider,
      userInput: 'run the test suite',
      maxSteps: 4,
      context: {
        tools: [],
        workspace: {
          root: 'C:/repo',
          topLevelEntries: ['package.json'],
          entryCount: 1,
        },
        repository: {
          packageManager: { name: 'npm', version: '10.9.2', source: 'packageManager' },
          scripts: [
            { name: 'build', command: 'tsc' },
            { name: 'test', command: 'vitest run' },
          ],
          workspaces: ['packages/agent'],
          keyFiles: ['package.json', 'README.md'],
          packageFiles: ['package.json', 'packages/agent/package.json'],
          git: {
            isRepository: true,
            branch: 'main',
            dirty: true,
            status: '## main\n M package.json',
          },
        },
        verification: {
          commands: [
            { name: 'test', command: 'npm run test', source: 'script', required: true },
            { name: 'build', command: 'npm run build', source: 'script', required: true },
          ],
        },
        model: { name: 'planner-model' },
        session: { messageCount: 2, hasLoadedHistory: false },
        platform: { os: process.platform, shell: '', homedir: '' },
      },
    })

    const userMessage = capturedMessages?.find((message) => message.role === 'user')
    expect(draft?.goal).toBe('Run verification')
    expect(String(userMessage?.content)).toContain('Package manager: npm@10.9.2')
    expect(String(userMessage?.content)).toContain('Scripts: build, test')
    expect(String(userMessage?.content)).toContain(
      'Verification commands: npm run test, npm run build'
    )
    expect(String(userMessage?.content)).toContain('Git: main, dirty')
    expect(String(userMessage?.content)).toContain('Key files: package.json, README.md')
  })
})
