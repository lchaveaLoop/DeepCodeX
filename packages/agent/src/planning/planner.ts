import { z } from 'zod'
import type { LLMProvider } from '../providers/llm-provider.js'
import type { AgentContext, PlanStep } from './types.js'

const PlanStepSchema = z.object({
  description: z.string(),
})
const PlanResponseSchema = z.object({
  steps: z.array(PlanStepSchema).min(1).max(7),
  goal: z.string().optional(),
})

function buildPlanningPrompt(userInput: string, context: AgentContext): string {
  const toolLines = context.tools.map(
    (t) => `- ${t.name}: ${t.description}${t.requiresConfirm ? ' (needs confirmation)' : ''}`
  )

  const recentLines =
    context.recentActions.length > 0
      ? context.recentActions.map(
          (a) => `- ${new Date(a.timestamp).toISOString()}: ${a.action} → ${a.result.slice(0, 80)}`
        )
      : ['(none)']

  return `You are a task planning expert. Your job is to break down a user request into executable steps. Below is your current environment and capabilities.

## Available Tools
${toolLines.join('\n')}

## Workspace
Root: ${context.workspace.root}
Top-level entries: ${context.workspace.topLevelEntries.join(', ') || '(empty)'}

## Platform
OS: ${context.platform.os} | Shell: ${context.platform.shell} | Home: ${context.platform.homedir}

## Available CLI
Node: ${context.environment.nodeVersion}
Git: ${context.environment.gitAvailable ? 'yes' : 'no'}
Python: ${context.environment.pythonAvailable ? 'yes' : 'no'}
npm: ${context.environment.npmAvailable ? 'yes' : 'no'}

## Constraints
Max tool-calling rounds: ${context.constraints.maxRounds}
Context window: ${context.constraints.maxContextTokens} tokens (${context.constraints.currentTokensUsed} used)

## Session
${context.session.messageCount} messages in history${context.session.hasLoadedHistory ? ' (loaded from file)' : ''}

## Recent Actions
${recentLines.join('\n')}

---

User request: ${userInput}

Output a JSON object with a "steps" array. Each step must have a "description" field. Steps should:
- Reference actual files from the workspace (use the correct paths)
- Use the correct shell syntax for the platform (${context.platform.os})
- Not exceed available tool-calling rounds
- Be ordered with dependencies first
- Not repeat actions already in Recent Actions

Example output:
{"steps": [{"description": "Read src/config.ts to understand the configuration"}, {"description": "Add a new environment variable to config.ts"}, {"description": "Update the README with the new variable"}]}`
}

export async function generatePlan(
  userInput: string,
  context: AgentContext,
  provider: LLMProvider,
  maxSteps: number = 7
): Promise<PlanStep[]> {
  const prompt = buildPlanningPrompt(userInput, context)

  const response = await provider.chat(
    [{ role: 'user', content: prompt }],
    [] // no tools for planning
  )

  const content = response.content.trim()

  // Try to extract JSON from the response (may be wrapped in markdown)
  let jsonStr = content
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim()
  }

  try {
    const parsed = PlanResponseSchema.parse(JSON.parse(jsonStr))
    return parsed.steps.slice(0, maxSteps).map((s, i) => ({
      id: `step-${i + 1}`,
      description: s.description,
      status: 'pending' as const,
    }))
  } catch (e) {
    // If parsing fails, return single-step plan (degrade gracefully)
    return [
      {
        id: 'step-1',
        description: userInput.slice(0, 200),
        status: 'pending',
      },
    ]
  }
}
