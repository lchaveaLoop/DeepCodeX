import type { AgentPlanState, PlanDraft, PlanStep, PlanStatus } from './types.js'

function now(): string {
  return new Date().toISOString()
}

function clip(text: string, max = 300): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export class TaskManager {
  private plan: AgentPlanState | null = null
  private planCounter = 0

  get currentPlan(): AgentPlanState | null {
    return this.plan
  }

  get currentStep(): PlanStep | null {
    return this.plan?.steps.find((step) => step.status === 'in_progress') ?? null
  }

  createPlan(draft: PlanDraft): AgentPlanState {
    this.planCounter += 1
    const timestamp = now()
    const steps: PlanStep[] = draft.steps.map((step, index) => ({
      id: `plan_step_${index + 1}`,
      description: step.description,
      dependsOn: step.dependsOn,
      status: index === 0 ? 'in_progress' : 'pending',
      startedAt: index === 0 ? timestamp : undefined,
    }))

    this.plan = {
      id: `plan_${this.planCounter}`,
      goal: draft.goal,
      status: steps.length > 0 ? 'running' : 'completed',
      createdAt: timestamp,
      updatedAt: timestamp,
      steps,
    }
    return this.plan
  }

  completeCurrentStep(result?: string): AgentPlanState | null {
    const step = this.currentStep
    if (!this.plan || !step) return this.plan

    const timestamp = now()
    step.status = 'done'
    step.result = result ? clip(result) : undefined
    step.endedAt = timestamp

    const next = this.plan.steps.find((candidate) => candidate.status === 'pending')
    if (next) {
      next.status = 'in_progress'
      next.startedAt = timestamp
      this.plan.status = 'running'
    } else {
      this.plan.status = 'completed'
    }
    this.plan.updatedAt = timestamp
    return this.plan
  }

  failCurrentStep(reason: string): AgentPlanState | null {
    return this.finishCurrentStep('failed', reason)
  }

  blockCurrentStep(reason: string): AgentPlanState | null {
    return this.finishCurrentStep('blocked', reason)
  }

  failPlan(reason: string): AgentPlanState | null {
    if (!this.plan) return null
    const step = this.currentStep
    if (step) {
      step.status = 'failed'
      step.result = clip(reason)
      step.endedAt = now()
    }
    this.plan.status = 'failed'
    this.plan.updatedAt = now()
    return this.plan
  }

  clearPlan(): AgentPlanState | null {
    const existing = this.plan
    if (existing) {
      existing.status = 'cleared'
      existing.updatedAt = now()
    }
    this.plan = null
    return existing
  }

  formatSummary(): string {
    if (!this.plan) return 'No active plan.'

    const lines = [`Goal: ${this.plan.goal}`, `Status: ${this.plan.status}`, 'Steps:']
    for (const step of this.plan.steps) {
      const result = step.result ? ` — ${step.result}` : ''
      lines.push(`- [${step.status}] ${step.id}: ${step.description}${result}`)
    }
    return lines.join('\n')
  }

  private finishCurrentStep(status: Extract<PlanStatus, 'failed' | 'blocked'>, reason: string) {
    const step = this.currentStep
    if (!this.plan || !step) return this.plan

    const timestamp = now()
    step.status = status
    step.result = clip(reason)
    step.endedAt = timestamp
    this.plan.status = status
    this.plan.updatedAt = timestamp
    return this.plan
  }
}
