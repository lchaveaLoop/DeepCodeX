# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

```
packages/
├── agent/              # Engine package (@fagent/agent)
│   ├── src/
│   │   ├── agent.ts        # Agent run loop — call → tool_detection → execute → repeat
│   │   ├── config.ts       # Env loader, provider config, workspace root
│   │   ├── llm.ts          # streamAndAccumulate() — streaming + tool_calls fragment assembly
│   │   ├── session.ts      # JSON save/load of message history
│   │   ├── core/
│   │   │   ├── event-emitter.ts  # Lightweight pub/sub (on/off/emit/once)
│   │   │   └── event-types.ts    # Typed event map (AgentEvent enum + AgentEventData)
│   │   ├── providers/
│   │   │   ├── llm-provider.ts        # LLMProvider interface + factory function
│   │   │   ├── deepseek-provider.ts   # DeepSeek (default) — uses reasoning_content field
│   │   │   ├── minimax-provider.ts    # MiniMax — parses <think> tags for reasoning
│   │   │   └── openai-provider.ts     # Generic OpenAI-compatible
│   │   └── tools/
│   │       ├── index.ts       # ToolRegistry + createRegistry() — Zod validation + execution
│   │       ├── workspace.ts   # read_file, write_file (with path-escape checks)
│   │       ├── shell.ts       # run_command (requires confirm)
│   │       └── web-search.ts  # web_search via DuckDuckGo HTML parsing
│   └── tests/
│       ├── agent.test.ts      # Agent loop tests with mocked streamAndAccumulate
│       └── tools.test.ts      # Tool handler pure-function tests
└── cli/                # Terminal entry (@fagent/cli)
    └── src/index.ts    # Interactive readline loop with ANSI output styling
.github/
└── workflows/
    ├── ci.yml         # CI: lint + test + coverage on PR/push (Ubuntu + Windows)
    └── release.yml    # Manual release: create GitHub Release with version tag
```

## Architecture

- **Agent loop** (`agent.ts`): `run()` iterates up to `MAX_TOOL_ROUNDS` (10). Each round: stream LLM response → detect `tool_calls` → execute tools → feed results back as messages. Stops when the model returns no tool calls.
- **Provider strategy**: `LLMProvider` interface with `chat()`, `stream()`, and `model` property. Factory `createLLMProvider()` auto-detects provider by baseURL. Set via `DEFAULT_PROVIDER` env var (`deepseek` | `minimax`).
- **Tool registry** (`tools/index.ts`): Each tool defines a Zod schema (`parameters`), a `handler`, and an optional `requiresConfirm` flag. `ToolRegistry.execute()` validates args via Zod before calling handler. `getDefinitions()` converts schemas to JSON Schema for the LLM.
- **Streaming** (`llm.ts`): Character-by-character output via callbacks (`onToken`, `onReasoning`, `onToolCall`). Tool call arguments arrive as JSON fragments across chunks — `tcBuf` assembles them by index.
- **Event system** (`core/`): `EventEmitter` emits typed events throughout the agent lifecycle (run start/end, round start/end, LLM request/response, tool events, message events). Used by consumers to observe without coupling.
- **CLI output**: Phase state machine (`idle → reasoning → content → tool_calls`) manages ANSI terminal output without visual jank.

## Key Patterns

- **Tool = `{ def, handler }` in registry**: Registration in each `tools/*.ts` file, not centralized.
- **Destructive tools flagged `requiresConfirm: true`**: Agent loop calls `onConfirm` callback; CLI prompts `[y/N]`.
- **Provider selection at runtime**: `DEFAULT_PROVIDER=minimax` env var switches between providers. The Agent constructor also accepts a provider directly via `AgentConfig`.
- **Session save/load**: JSON file round-trip via `saveSession()`/`loadSession()`.

## Gotchas

- **`WORKSPACE_ROOT` is `process.cwd()` at import time** — tests must patch via `setWorkspaceRoot()`.
- **Agent tests mock `../src/llm.js`** (the import location, not the definition location).
- **`tool_calls` arguments are JSON fragments in stream**, not full objects — `tcBuf` assembles by index across chunks.
- **MiniMax reasoning**: Uses `</think>` tags in content; the MiniMax provider strips these and routes to `onReasoning`.
- **DeepSeek reasoning**: Uses `reasoning_content` field (non-standard), routed to `onReasoning` in `streamAndAccumulate`.
- **Workspace security**: `read_file` and `write_file` block paths escaping workspace root and paths containing `.env`, `.git`, `node_modules`, etc.
- **Tool error recovery**: Tool execution failures are pushed to message history as error strings rather than thrown, so the model can recover.

## Commands

```bash
# Install dependencies (uses pnpm)
pnpm install

# Run CLI
pnpm dev

# Build both packages (⚠ known failure — pre-existing TypeScript errors)
pnpm build

# Run all tests with coverage
pnpm test -- --coverage

# Run tests without coverage
pnpm test

# Run single test file
cd packages/agent && pnpm exec vitest run tests/tools.test.ts

# Run a specific test
cd packages/agent && pnpm exec vitest run tests/agent.test.ts -t "single round tool call"

# Lint
pnpm lint

# Format
pnpm format

# Check formatting
pnpm format:check
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Triggered on push/PR to main/master. Runs lint + test with coverage on Ubuntu + Windows (Node 20). Coverage thresholds enforced.
- **Release** (`.github/workflows/release.yml`): Manual trigger via GitHub UI. Creates a GitHub Release with auto-generated changelog.
- Coverage threshold is enforced via `packages/agent/vitest.config.ts`. Adjust thresholds there when adding tests.
- Current coverage: ~40% statements, ~27% branches, ~43% functions, ~41% lines. Thresholds are set at current levels and should be raised as coverage improves.
- `pnpm build` (TypeScript `tsc`) has pre-existing errors. The project runs via `tsx` at runtime, so CI skips the build step.

## Commit Convention

Conventional Commits (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `build:`, `ci:`, `chore:`, `revert:`). Enforced by commitlint + husky pre-commit hook (lint-staged).

## Environment Variables

- `DEEPSEEK_API_KEY` — DeepSeek API key (default provider)
- `MINIMAX_API_KEY` — MiniMax API key
- `DEFAULT_PROVIDER` — `deepseek` (default) or `minimax`
- `MINIMAX_BASE_URL` / `MINIMAX_MODEL` — Optional MiniMax overrides

Create a `.env` file in the project root.
