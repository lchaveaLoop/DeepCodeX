import { describe, expect, it } from 'vitest';

import {
  renderConfirmationCard,
  renderHelp,
  renderRunCockpit,
  renderRunSummary,
  renderToolCallLine,
  renderToolResultPreview,
  renderWelcome,
} from '../src/run-render.js';
import type { AgentRunState } from '@fagent/agent';

const baseRun: AgentRunState = {
  id: 'run_1',
  input: 'ship the change',
  status: 'completed',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:00:05.000Z',
  totalRounds: 2,
  output: 'Done.',
  workspaceChanges: {
    changed: true,
    changes: [
      {
        kind: 'file_write',
        sourceTool: 'write_file',
        target: 'src/index.ts',
        summary: 'write_file src/index.ts',
        confidence: 'confirmed',
        toolCallId: 'c0',
        round: 1,
        timestamp: '2026-01-01T00:00:00.500Z',
      },
    ],
  },
  steps: [
    {
      id: 'step_1',
      index: 0,
      kind: 'tool_result',
      timestamp: '2026-01-01T00:00:01.000Z',
      toolName: 'read_file',
      data: { ok: true },
    },
    {
      id: 'step_2',
      index: 1,
      kind: 'tool_result',
      timestamp: '2026-01-01T00:00:02.000Z',
      toolName: 'run_command',
      data: { ok: true },
    },
  ],
  verification: {
    commands: [
      { name: 'test', command: 'npm run test', source: 'script', required: true },
      { name: 'build', command: 'npm run build', source: 'script', required: true },
    ],
    results: [
      {
        name: 'test',
        command: 'npm run test',
        ok: true,
        status: 'passed',
        content: 'ok',
        duration: 120,
        toolCallId: 'c1',
        round: 1,
        timestamp: '2026-01-01T00:00:03.000Z',
      },
    ],
  },
};

describe('run rendering', () => {
  it('renders a product-oriented welcome screen', () => {
    const rendered = renderWelcome({
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-pro',
      workspace: 'E:/repo',
    });

    expect(rendered).toContain('DeepCodeX Agent');
    expect(rendered).toContain('Provider: DEEPSEEK');
    expect(rendered).toContain('Mode: compact output');
    expect(rendered).toContain('/help');
  });

  it('renders command help with output mode controls', () => {
    const rendered = renderHelp();

    expect(rendered).toContain('/verbose');
    expect(rendered).toContain('/compact');
    expect(rendered).toContain('/status');
  });

  it('renders an empty run state', () => {
    expect(renderRunSummary(null)).toContain('No run has completed yet.');
  });

  it('summarizes status, rounds, tools, and verification progress', () => {
    const rendered = renderRunSummary(baseRun);

    expect(rendered).toContain('Run: completed');
    expect(rendered).toContain('Delivery: needs verification');
    expect(rendered).toContain('Workspace changes: 1');
    expect(rendered).toContain('Rounds: 2');
    expect(rendered).toContain('Tools: 2 total, 2 succeeded, 0 failed');
    expect(rendered).toContain('Verification: 1/2 passed');
    expect(rendered).toContain('[passed] npm run test');
    expect(rendered).toContain('[pending] npm run build');
  });

  it('surfaces failed verification commands', () => {
    const rendered = renderRunSummary({
      ...baseRun,
      verification: {
        commands: baseRun.verification!.commands,
        results: [
          {
            name: 'test',
            command: 'npm run test',
            ok: false,
            status: 'failed',
            content: 'failed',
            error: 'failed',
            duration: 90,
            toolCallId: 'c1',
            round: 1,
            timestamp: '2026-01-01T00:00:03.000Z',
          },
        ],
      },
    });

    expect(rendered).toContain('Verification: 0/2 passed, 1 failed');
    expect(rendered).toContain('Delivery: verification failed');
    expect(rendered).toContain('[failed] npm run test');
  });

  it('marks delivery ready when all required verification commands passed', () => {
    const rendered = renderRunSummary({
      ...baseRun,
      verification: {
        commands: [
          { name: 'test', command: 'npm run test', source: 'script', required: true },
          { name: 'build', command: 'npm run build', source: 'script', required: true },
          { name: 'typecheck', command: 'npm run typecheck', source: 'script', required: false },
        ],
        results: [
          {
            name: 'test',
            command: 'npm run test',
            ok: true,
            status: 'passed',
            content: 'ok',
            duration: 120,
            toolCallId: 'c1',
            round: 1,
            timestamp: '2026-01-01T00:00:03.000Z',
          },
          {
            name: 'build',
            command: 'npm run build',
            ok: true,
            status: 'passed',
            content: 'ok',
            duration: 220,
            toolCallId: 'c2',
            round: 1,
            timestamp: '2026-01-01T00:00:04.000Z',
          },
        ],
      },
    });

    expect(rendered).toContain('Delivery: ready');
    expect(rendered).toContain('Verification: 2/3 passed');
    expect(rendered).toContain('[pending] npm run typecheck');
  });

  it('does not require verification for read-only runs', () => {
    const rendered = renderRunSummary({
      ...baseRun,
      workspaceChanges: { changed: false, changes: [] },
      verification: {
        commands: baseRun.verification!.commands,
        results: [],
      },
    });

    expect(rendered).toContain('Delivery: ready (no workspace changes)');
    expect(rendered).toContain('Workspace changes: none');
    expect(rendered).toContain('Verification: 0/2 passed');
  });

  it('renders a cockpit view for fast status scanning', () => {
    const rendered = renderRunCockpit(baseRun);

    expect(rendered).toContain('Cockpit');
    expect(rendered).toContain('Run: completed');
    expect(rendered).toContain('Delivery: needs verification');
    expect(rendered).toContain('Required verification: 1/2 passed');
  });

  it('renders compact tool call and result previews', () => {
    expect(renderToolCallLine('run_command', { command: 'npm run test' })).toBe(
      'Tool: run_command npm run test',
    );
    expect(renderToolCallLine('write_file', { path: 'src/index.ts', content: 'hello' })).toContain(
      'src/index.ts (5 bytes)',
    );

    const compact = renderToolResultPreview('line one\nline two\nline three', { verbose: false });
    expect(compact).toBe('Result: line one (+2 lines)');

    const verbose = renderToolResultPreview('line one\nline two', { verbose: true });
    expect(verbose).toContain('line two');
  });

  it('renders an approval card with risk and primary target', () => {
    const rendered = renderConfirmationCard({
      name: 'run_command',
      args: { command: 'npm install left-pad' },
      execution: {
        summary: 'npm install left-pad',
        risk: 'medium',
        blocked: false,
        requiresConfirmation: true,
        reasons: ['command may change dependencies'],
      },
    });

    expect(rendered).toContain('Action requires approval');
    expect(rendered).toContain('Tool: run_command');
    expect(rendered).toContain('Risk: MEDIUM');
    expect(rendered).toContain('Approve? [y] run');
  });
});
