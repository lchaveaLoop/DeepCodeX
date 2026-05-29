import type { AgentPlanState } from '@fagent/agent';

export function renderPlan(plan: AgentPlanState | null): string {
  if (!plan) return 'No active plan.';

  const lines = [`Plan: ${plan.goal}`, `Status: ${plan.status}`];
  for (const step of plan.steps) {
    const result = step.result ? ` — ${step.result}` : '';
    lines.push(`  [${step.status}] ${step.description}${result}`);
  }
  return lines.join('\n');
}

export function renderPlanProgress(plan: AgentPlanState): string {
  const active =
    plan.steps.find((step) => step.status === 'in_progress') ??
    [...plan.steps].reverse().find((step) => step.status !== 'pending');

  if (!active) return `plan ${plan.status}: ${plan.goal}`;
  return `plan ${active.status}: ${active.description}`;
}
