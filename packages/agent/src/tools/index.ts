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

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name)
    if (!tool) return `Error: unknown tool '${name}'`

    const parsed = tool.parameters.safeParse(args)
    if (!parsed.success) {
      return `Error: invalid arguments for '${name}' — ${parsed.error.message}`
    }

    try {
      return await tool.handler(parsed.data)
    } catch (e) {
      return `Error: tool '${name}' failed — ${e}`
    }
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
