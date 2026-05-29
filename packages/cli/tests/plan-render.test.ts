import { describe, expect, it } from 'vitest';

import { renderPlan, renderPlanProgress } from '../src/plan-render.js';
import type { AgentPlanState } from '@fagent/agent';

const plan: AgentPlanState = {
  id: 'plan_1',
  goal: 'Ship feature',
  status: 'running',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  steps: [
    {
      id: 'plan_step_1',
      description: 'Inspect code',
      status: 'done',
      result: 'Read files',
    },
    {
      id: 'plan_step_2',
      description: 'Edit code',
      status: 'in_progress',
    },
  ],
};

describe('plan rendering', () => {
  it('renders an empty plan state', () => {
    expect(renderPlan(null)).toContain('No active plan.');
  });

  it('renders plan goal and step statuses', () => {
    const rendered = renderPlan(plan);

    expect(rendered).toContain('Plan: Ship feature');
    expect(rendered).toContain('[done] Inspect code');
    expect(rendered).toContain('[in_progress] Edit code');
  });

  it('renders compact progress for the active step', () => {
    expect(renderPlanProgress(plan)).toContain('plan in_progress: Edit code');
  });
});
