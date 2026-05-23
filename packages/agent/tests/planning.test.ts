import { describe, it, expect, vi } from 'vitest'
import { TaskManager } from '../src/planning/task-manager.js'
import type { PlanStep, AgentContext } from '../src/planning/types.js'

describe('TaskManager', () => {
  it('creates and progresses steps', () => {
    const tm = new TaskManager(
      [
        { id: 'step-1', description: 'Read config', status: 'pending' },
        { id: 'step-2', description: 'Edit config', status: 'pending' },
        { id: 'step-3', description: 'Test', status: 'pending' },
      ],
      'Test goal'
    )

    expect(tm.getCurrentStep()?.id).toBe('step-1')
    expect(tm.isComplete()).toBe(false)

    const progress1 = tm.getProgress()
    expect(progress1.done).toBe(0)
    expect(progress1.total).toBe(3)

    tm.markStepDone('step-1', 'Config read successfully')
    expect(tm.getCurrentStep()?.id).toBe('step-2')
    expect(tm.getProgress().done).toBe(1)

    tm.markStepDone('step-2')
    expect(tm.getCurrentStep()?.id).toBe('step-3')
    expect(tm.getProgress().done).toBe(2)

    tm.markStepDone('step-3', 'All done')
    expect(tm.getCurrentStep()).toBeNull()
    expect(tm.isComplete()).toBe(true)
    expect(tm.getProgress().done).toBe(3)
  })

  it('handles failed steps', () => {
    const tm = new TaskManager(
      [
        { id: 's1', description: 'Task 1', status: 'pending' },
        { id: 's2', description: 'Task 2', status: 'pending' },
      ],
      'Goal'
    )

    tm.markStepFailed('s1', 'Network error')
    expect(tm.hasFailures()).toBe(true)
    expect(tm.isComplete()).toBe(false) // s2 still pending
    expect(tm.getProgress().failed).toBe(1)

    tm.markStepDone('s2')
    expect(tm.isComplete()).toBe(false) // s1 failed, not done
  })

  it('skips steps', () => {
    const tm = new TaskManager(
      [
        { id: 'a', description: 'A', status: 'pending' },
        { id: 'b', description: 'B', status: 'pending' },
      ],
      'G'
    )

    tm.markStepSkipped('a', 'Not needed')
    expect(tm.getCurrentStep()?.id).toBe('b')
    expect(tm.getProgress().done).toBe(1) // skipped counts as done
  })

  it('generates readable summary', () => {
    const tm = new TaskManager(
      [{ id: 's1', description: 'Read file', status: 'done', result: 'Success' }],
      'Simple task'
    )

    const summary = tm.getPlanSummary()
    expect(summary).toContain('Simple task')
    expect(summary).toContain('1/1')
    expect(summary).toContain('Read file')
  })

  it('serializes and deserializes', () => {
    const tm = new TaskManager(
      [{ id: 'x', description: 'Do X', status: 'done', result: 'ok' }],
      'Test'
    )
    const json = tm.toJSON()
    const restored = TaskManager.fromJSON(json)

    expect(restored.isComplete()).toBe(true)
    expect(restored.getProgress().done).toBe(1)
    expect(restored.getPlanSummary()).toContain('Test')
  })

  it('createPlan resets state', () => {
    const tm = new TaskManager(
      [{ id: 'old', description: 'Old step', status: 'done' }],
      'Old goal'
    )
    tm.createPlan([{ description: 'New step 1' }, { description: 'New step 2' }])

    expect(tm.getProgress().total).toBe(2)
    expect(tm.getCurrentStep()?.description).toBe('New step 1')
    expect(tm.getSteps().every((s) => s.status === 'pending')).toBe(true)
  })
})

describe('generatePlan (mock)', () => {
  it('parses valid JSON plan from LLM response', async () => {
    const { generatePlan } = await import('../src/planning/planner.js')

    const mockProvider = {
      model: 'test-model',
      chat: vi.fn().mockResolvedValue({
        content: '{"steps": [{"description": "Step A"}, {"description": "Step B"}]}',
        reasoning: null,
        toolCalls: [],
      }),
    } as any

    const context: AgentContext = {
      tools: [],
      workspace: { root: '/tmp', topLevelEntries: [], entryCount: 0 },
      constraints: { maxRounds: 10, maxContextTokens: 128000, currentTokensUsed: 0 },
      model: { name: 'test', provider: 'test' },
      session: { messageCount: 1, hasLoadedHistory: false },
      platform: { os: 'linux', shell: '/bin/bash', homedir: '/home/test' },
      environment: { nodeVersion: 'v20', gitAvailable: true, pythonAvailable: false, npmAvailable: true },
      recentActions: [],
    }

    const steps = await generatePlan('Do something', context, mockProvider)
    expect(steps).toHaveLength(2)
    expect(steps[0].id).toBe('step-1')
    expect(steps[0].description).toBe('Step A')
    expect(steps[0].status).toBe('pending')
  })

  it('degrades gracefully on invalid JSON', async () => {
    const { generatePlan } = await import('../src/planning/planner.js')

    const mockProvider = {
      model: 'test-model',
      chat: vi.fn().mockResolvedValue({
        content: 'not valid json at all',
        reasoning: null,
        toolCalls: [],
      }),
    } as any

    const context: AgentContext = {
      tools: [],
      workspace: { root: '/tmp', topLevelEntries: [], entryCount: 0 },
      constraints: { maxRounds: 10, maxContextTokens: 128000, currentTokensUsed: 0 },
      model: { name: 'test', provider: 'test' },
      session: { messageCount: 1, hasLoadedHistory: false },
      platform: { os: 'linux', shell: '/bin/bash', homedir: '/home/test' },
      environment: { nodeVersion: 'v20', gitAvailable: true, pythonAvailable: false, npmAvailable: true },
      recentActions: [],
    }

    const steps = await generatePlan('Fallback test', context, mockProvider)
    expect(steps).toHaveLength(1) // degraded to single-step plan
    expect(steps[0].description).toContain('Fallback test')
  })

  it('extracts JSON from markdown code blocks', async () => {
    const { generatePlan } = await import('../src/planning/planner.js')

    const mockProvider = {
      model: 'test-model',
      chat: vi.fn().mockResolvedValue({
        content: '```json\n{"steps": [{"description": "A"}, {"description": "B"}, {"description": "C"}]}\n```',
        reasoning: null,
        toolCalls: [],
      }),
    } as any

    const context: AgentContext = {
      tools: [],
      workspace: { root: '/tmp', topLevelEntries: [], entryCount: 0 },
      constraints: { maxRounds: 10, maxContextTokens: 128000, currentTokensUsed: 0 },
      model: { name: 'test', provider: 'test' },
      session: { messageCount: 1, hasLoadedHistory: false },
      platform: { os: 'linux', shell: '/bin/bash', homedir: '/home/test' },
      environment: { nodeVersion: 'v20', gitAvailable: true, pythonAvailable: false, npmAvailable: true },
      recentActions: [],
    }

    const steps = await generatePlan('Test', context, mockProvider)
    expect(steps).toHaveLength(3)
  })
})
