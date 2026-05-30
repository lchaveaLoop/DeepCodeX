import { z } from 'zod'

// ═══════════════════════════════════════════════════
// Tool definition type
// ═══════════════════════════════════════════════════

export interface ToolDef<Args extends z.ZodTypeAny> {
  name: string
  description: string
  parameters: Args
  handler: (_args: z.infer<Args>) => string | Promise<string>
  requiresConfirm?: boolean
  describeExecution?: (_args: z.infer<Args>) => ToolExecutionInfo
}

export type ToolRiskLevel = 'low' | 'medium' | 'high' | 'blocked'

export interface ToolExecutionInfo {
  summary: string
  risk: ToolRiskLevel
  blocked: boolean
  requiresConfirmation: boolean
  reasons: string[]
}

export interface ToolExecutionResult {
  ok: boolean
  toolName: string
  content: string
  duration: number
  error?: string
  execution?: ToolExecutionInfo
}

// ═══════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════

import { zodToJsonSchema } from 'zod-to-json-schema'

export class ToolRegistry {
  private tools = new Map<string, ToolDef<z.ZodTypeAny>>()

  register<Args extends z.ZodTypeAny>(tool: ToolDef<Args>): void {
    this.tools.set(tool.name, tool as unknown as ToolDef<z.ZodTypeAny>)
  }

  get(name: string): ToolDef<z.ZodTypeAny> | undefined {
    return this.tools.get(name)
  }

  listNames(): string[] {
    return [...this.tools.keys()]
  }

  getDefinitions(): Record<string, unknown>[] {
    return [...this.tools.values()].map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.parameters),
      },
    }))
  }

  describeExecution(name: string, args: Record<string, unknown>): ToolExecutionInfo | undefined {
    const tool = this.tools.get(name)
    if (!tool?.describeExecution) return undefined

    const parsed = tool.parameters.safeParse(args)
    if (!parsed.success) return undefined

    return tool.describeExecution(parsed.data)
  }

  async executeDetailed(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const start = Date.now()
    const tool = this.tools.get(name)
    if (!tool) {
      const content = `Error: unknown tool '${name}'`
      return {
        ok: false,
        toolName: name,
        content,
        error: content,
        duration: Date.now() - start,
      }
    }

    const parsed = tool.parameters.safeParse(args)
    if (!parsed.success) {
      const content = `Error: invalid arguments for '${name}' — ${parsed.error.message}`
      return {
        ok: false,
        toolName: name,
        content,
        error: content,
        duration: Date.now() - start,
      }
    }

    const execution = tool.describeExecution?.(parsed.data)
    if (execution?.blocked) {
      const content =
        `Error: command blocked by safety policy: ${execution.summary}` +
        (execution.reasons.length > 0 ? `\nReasons:\n- ${execution.reasons.join('\n- ')}` : '')
      return {
        ok: false,
        toolName: name,
        content,
        error: content,
        execution,
        duration: Date.now() - start,
      }
    }

    try {
      const content = await tool.handler(parsed.data)
      const ok = !content.startsWith('Error:')
      return {
        ok,
        toolName: name,
        content,
        error: ok ? undefined : content,
        execution,
        duration: Date.now() - start,
      }
    } catch (e) {
      const content = `Error: tool '${name}' failed — ${e}`
      return {
        ok: false,
        toolName: name,
        content,
        error: content,
        execution,
        duration: Date.now() - start,
      }
    }
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.executeDetailed(name, args)
    return result.content
  }
}

// ═══════════════════════════════════════════════════
// Register all tools
// ═══════════════════════════════════════════════════

import { webSearchTool } from './web-search.js'
import { readFileTool, writeFileTool } from './workspace.js'
import { runCommandTool } from './shell.js'
import { listDirectoryTool, directoryTreeTool, globTool, getFileInfoTool } from './filesystem.js'
import { searchFilesTool, searchContentTool } from './search.js'

export function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register(webSearchTool)
  registry.register(readFileTool)
  registry.register(writeFileTool)
  registry.register(runCommandTool)
  registry.register(listDirectoryTool)
  registry.register(directoryTreeTool)
  registry.register(globTool)
  registry.register(getFileInfoTool)
  registry.register(searchFilesTool)
  registry.register(searchContentTool)
  return registry
}
