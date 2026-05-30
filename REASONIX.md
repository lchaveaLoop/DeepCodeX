# REASONIX.md — FAgent TypeScript

## Stack

- **Language**: TypeScript 5.7 (ESM modules)
- **Model**: DeepSeek v4-pro by default via `openai` SDK; generic OpenAI-compatible providers remain available through `OpenAIProvider`
- **Validation**: Zod — tool args schemas → JSON Schema + runtime validation
- **Streaming**: real-time `stream=True` + incremental `tool_calls` assembly
- **Testing**: Vitest
- **Linting**: ESLint 9 + typescript-eslint
- **Formatting**: Prettier 3
- **Git Hooks**: Husky 9 + lint-staged + Commitlint

## Layout

| Dir/File                                 | Purpose                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/agent/src/config.ts`           | `.env` loader, DeepSeek model config, `MAX_TOOL_ROUNDS`, `WORKSPACE_ROOT`    |
| `packages/agent/src/llm.ts`              | `streamAndAccumulate()` — streaming + tool_calls fragment assembly           |
| `packages/agent/src/agent.ts`            | `Agent` class — plan context + model loop + structured tool execution        |
| `packages/agent/src/providers/`          | `LLMProvider`, `DeepSeekProvider`, and generic `OpenAIProvider`              |
| `packages/agent/src/planning/`           | Plan state, repo intelligence, verification inference, planner context       |
| `packages/agent/src/tools/index.ts`      | `ToolRegistry`, `ToolDef`, structured `ToolExecutionResult`                  |
| `packages/agent/src/tools/workspace.ts`  | `read_file`, `write_file`                                                    |
| `packages/agent/src/tools/shell.ts`      | `run_command` with risk classification, blocked commands, output truncation  |
| `packages/agent/src/tools/web-search.ts` | `web_search` via DuckDuckGo                                                  |
| `packages/agent/src/session.ts`          | JSON save/load of message history                                            |
| `packages/cli/src/index.ts`              | CLI entry: `/status`, `/plan`, `/save`, `/load`, `/tools`, `/reset`, `/exit` |
| `packages/cli/src/run-render.ts`         | Pure renderer for run status, tool counts, and verification results          |
| `packages/agent/tests/tools.test.ts`     | Pure function tests for tool handlers                                        |
| `packages/agent/tests/agent.test.ts`     | Agent loop tests with mock `streamAndAccumulate`                             |
| `packages/agent/eslint.config.js`        | ESLint config for agent package                                              |
| `packages/cli/eslint.config.js`          | ESLint config for CLI package                                                |
| `prettier.config.js`                     | Prettier shared config                                                       |
| `.commitlintrc.json`                     | Commit message format rules                                                  |
| `.husky/pre-commit`                      | Pre-commit hook (lint-staged)                                                |
| `.husky/commit-msg`                      | Commit-msg hook (commitlint)                                                 |

## Commands

```bash
# 安装依赖
npm install

# 运行 CLI
npm run dev

# 运行测试
cd packages/agent && npm run test

# 代码检查 & 格式化
npm run lint          # ESLint
npm run format        # Prettier 自动修复
npm run format:check  # 检查格式

# 初始化 Git Hooks（需先初始化 git 仓库）
git init
npm run install-hooks

# 提交代码（自动触发 lint + commitlint）
git add .
git commit -m "feat: add new feature"
```

## Commit Message 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

# 示例
feat(agent): add memory system
fix(tools): correct shell command timeout
docs: update README
style(cli): adjust terminal colors
refactor(llm): simplify stream handling
perf: improve tool execution speed
test: add integration tests
build: update dependencies
ci: add GitHub Actions workflow
chore: cleanup configuration
```

**Type 类型**：

- `feat` — 新功能
- `fix` — 修复 bug
- `docs` — 文档修改
- `style` — 代码格式（不影响功能）
- `refactor` — 重构
- `perf` — 性能优化
- `test` — 测试相关
- `build` — 构建相关
- `ci` — CI 配置
- `chore` — 其他杂项
- `revert` — 回滚

## Conventions

- **Zod args schema per tool** — `ReadFileArgs`, `WriteFileArgs`, etc. Each defines the JSON Schema the model sees AND validates runtime input
- **Tool = `{ def, handler }` in registry** — registration happens in each `tools/*.ts`
- **Tool args validated at registry execution** — Zod catches bad args before handler runs
- **Structured tool results** — `executeDetailed()` returns `ok`, `content`, `error`, `duration`, and optional execution metadata
- **Repository intelligence** — planner context includes package manager, scripts, workspaces, key files, package files, and Git dirty state
- **Verification inference** — standard scripts (`test`, `build`, `lint`, optional `typecheck`) are converted into suggested verification commands and recorded when executed through `run_command`
- **Verification context injection** — each model round receives required verification commands and current verification results as short system context
- **Workspace change tracking** — run state records confirmed `write_file` changes and possible medium/high-risk command changes
- **Delivery visibility** — CLI `/status` and post-run summaries show run status, workspace changes, delivery gate, tool success/failure counts, and verification progress
- **Destructive tools flagged `requiresConfirm: true`** — agent loop prompts user `[y/N]` before execution
- **Command safety preflight** — `run_command` classifies commands as `low`, `medium`, `high`, or `blocked`; blocked commands do not reach confirmation or shell execution
- **Command cwd** — `run_command` executes in the configured `WORKSPACE_ROOT`
- **Provider selection** — default agent construction uses DeepSeek; custom OpenAI-compatible providers can be passed through `AgentConfig.provider` or `createLLMProvider()`
- **Streaming state machine in `llm.ts`** — `tcBuf[index]` accumulates fragments across chunks, `JSON.parse` assembles final args
- **ANSI colors** — dim gray for reasoning, cyan for tool names, yellow for confirm prompts, green for user prompt

## Code Quality

- **ESLint rules**: warnings for `no-unused-vars`, `@typescript-eslint/no-explicit-any`; errors fail CI
- **Prettier formatting**: run `npm run format` before commit (handled by lint-staged)
- **TypeScript strict**: prefer explicit types over `any`; use `unknown` when type is unclear
- **ESLint config per package**: `packages/agent/eslint.config.js` and `packages/cli/eslint.config.js`

## Watch out for

- **`WORKSPACE_ROOT` defaults to `Path.cwd()` at import time** — tests and embedders can patch it via `setWorkspaceRoot()`
- **`.env` path resolution** — `dotenv.config()` reads from project root; run CLI from root or set correct path
- **DeepSeek API quirk** — `reasoning_content` arrives via `getattr(delta, "reasoning_content", None)`, not a standard field
- **`tool_calls` arguments are JSON fragments in stream**, not full objects — `tcBuf` assembles them by index across chunks
- **Do not edit `node_modules/`, `.pytest_cache/`** — all generated
- **`agent.test.ts` mocks `src/llm.js`** — the mock path uses the import location, not the definition location
