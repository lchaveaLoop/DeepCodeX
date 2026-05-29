import { describe, expect, it } from 'vitest'
import path from 'node:path'

import { setWorkspaceRoot } from '../src/config.js'
import { buildAgentContext, TaskManager } from '../src/planning/index.js'
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
})
