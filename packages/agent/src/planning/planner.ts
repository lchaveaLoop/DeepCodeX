import { z } from 'zod'
import type OpenAI from 'openai'
import type { LLMProvider } from '../providers/llm-provider.js'
import type { PlanningConfig, PlanDraft } from './types.js'
import type { AgentContext } from './context.js'

const PlanResponse = z.object({
  goal: z.string().min(1),
  steps: z
    .array(
      z.object({
        description: z.string().min(1),
        dependsOn: z.array(z.string()).optional(),
      })
    )
    .min(1),
})

const DEFAULT_PLANNING: Required<PlanningConfig> = {
  enabled: true,
  mode: 'auto',
  maxSteps: 6,
}

const PLANNING_KEYWORDS = [
  '实现',
  '修复',
  '重构',
  '开发',
  '计划',
  '构建',
  '添加',
  '删除',
  'implement',
  'fix',
  'refactor',
  'build',
  'develop',
  'add',
  'remove',
]

export function normalizePlanningConfig(config?: PlanningConfig): Required<PlanningConfig> {
  return {
    ...DEFAULT_PLANNING,
    ...config,
    mode: config?.enabled === false ? 'off' : (config?.mode ?? DEFAULT_PLANNING.mode),
  }
}

export function shouldCreatePlan(input: string, config: Required<PlanningConfig>): boolean {
  if (!config.enabled || config.mode === 'off') return false
  if (config.mode === 'always') return true

  const lowered = input.toLowerCase()
  if (input.length >= 80) return true
  if (PLANNING_KEYWORDS.some((keyword) => lowered.includes(keyword.toLowerCase()))) return true

  const actionMatches = lowered.match(/\b(read|write|run|test|update|create|delete|change)\b/g)
  return (actionMatches?.length ?? 0) >= 2
}

export async function createPlanDraft(options: {
  provider: LLMProvider
  userInput: string
  context: AgentContext
  maxSteps: number
}): Promise<PlanDraft | null> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'Create a concise execution plan for a coding agent. Return only JSON with shape {"goal": string, "steps": [{"description": string, "dependsOn"?: string[]}]}. Do not include markdown.',
    },
    {
      role: 'user',
      content: [
        `User request: ${options.userInput}`,
        `Workspace: ${options.context.workspace.root}`,
        `Tools: ${options.context.tools.map((tool) => tool.name).join(', ')}`,
        `Maximum steps: ${options.maxSteps}`,
      ].join('\n'),
    },
  ]

  const response = await options.provider.chat(messages)
  const json = extractJson(response.content)
  if (!json) return null

  const parsedJson = JSON.parse(json) as unknown
  const parsed = PlanResponse.safeParse(parsedJson)
  if (!parsed.success) return null

  return {
    goal: parsed.data.goal,
    steps: parsed.data.steps.slice(0, options.maxSteps),
  }
}

function extractJson(content: string): string | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) return fenced[1].trim()

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }
  return null
}
