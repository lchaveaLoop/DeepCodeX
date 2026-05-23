import type { PlanStep } from './types.js'

export class TaskManager {
  private steps: PlanStep[]
  private goal: string

  constructor(steps: PlanStep[], goal: string) {
    this.steps = steps.map((s, i) => ({
      ...s,
      id: s.id || `step-${i + 1}`,
      status: s.status || 'pending',
    }))
    this.goal = goal
  }

  createPlan(steps: Omit<PlanStep, 'id' | 'status'>[]): void {
    this.steps = steps.map((s, i) => ({
      ...s,
      id: `step-${i + 1}`,
      status: 'pending' as const,
    }))
  }

  getCurrentStep(): PlanStep | null {
    return this.steps.find((s) => s.status === 'pending') ?? null
  }

  markStepDone(stepId: string, result?: string): void {
    const step = this.steps.find((s) => s.id === stepId)
    if (step) {
      step.status = 'done'
      if (result) step.result = result
    }
  }

  markStepFailed(stepId: string, reason?: string): void {
    const step = this.steps.find((s) => s.id === stepId)
    if (step) {
      step.status = 'failed'
      if (reason) step.result = reason
    }
  }

  markStepSkipped(stepId: string, reason?: string): void {
    const step = this.steps.find((s) => s.id === stepId)
    if (step) {
      step.status = 'skipped'
      if (reason) step.result = reason
    }
  }

  getProgress(): { done: number; failed: number; total: number; current: PlanStep | null } {
    const done = this.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
    const failed = this.steps.filter((s) => s.status === 'failed').length
    return {
      done,
      failed,
      total: this.steps.length,
      current: this.getCurrentStep(),
    }
  }

  isComplete(): boolean {
    return this.steps.every((s) => s.status === 'done' || s.status === 'skipped')
  }

  hasFailures(): boolean {
    return this.steps.some((s) => s.status === 'failed')
  }

  getPlanSummary(): string {
    const { done, failed, total, current } = this.getProgress()
    const lines: string[] = [`Goal: ${this.goal}`, `Progress: ${done}/${total} steps done`]
    if (failed > 0) lines.push(`  ${failed} step(s) failed`)

    lines.push('')
    for (const step of this.steps) {
      const icon =
        step.status === 'done'
          ? '✅'
          : step.status === 'failed'
            ? '❌'
            : step.status === 'skipped'
              ? '⏭️ '
              : step.status === 'in_progress'
                ? '🔄'
                : '⬜'
      lines.push(`  ${icon} ${step.id}: ${step.description}`)
      if (step.result) lines.push(`     └─ ${step.result.slice(0, 120)}`)
    }

    if (current) {
      lines.push('')
      lines.push(`Next: ${current.id} — ${current.description}`)
    }

    return lines.join('\n')
  }

  getSteps(): PlanStep[] {
    return [...this.steps]
  }

  toJSON(): { steps: PlanStep[]; goal: string } {
    return { steps: this.steps, goal: this.goal }
  }

  static fromJSON(data: { steps: PlanStep[]; goal: string }): TaskManager {
    return new TaskManager(data.steps, data.goal)
  }
}
