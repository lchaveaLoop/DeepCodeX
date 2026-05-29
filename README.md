# FAgent — DeepSeek Code Agent

专为 DeepSeek 模型定制的代码智能体，当前提供 **CLI 终端** 运行模式，并保留通用 OpenAI-compatible Provider 扩展点。

## 快速开始

### 安装依赖

```bash
# 根目录
cd packages/agent && npm install
cd ../cli && npm install
```

### 运行 CLI

```bash
# 从项目根
cd packages/cli && npx tsx src/index.ts

# 或从项目根直接
node --import ./packages/cli/node_modules/tsx/dist/register-lJYvHe5s.mjs ./packages/cli/src/index.ts
```

确保项目根 `.env` 文件包含：

```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
```

### CLI 命令

| 命令           | 作用                     |
| -------------- | ------------------------ |
| `/tools`       | 列出所有可用工具         |
| `/save <path>` | 保存当前会话到 JSON 文件 |
| `/load <path>` | 从 JSON 文件恢复历史会话 |
| `/reset`       | 重置会话，开始新对话     |
| `/help`        | 显示帮助信息             |
| `/exit`        | 退出                     |

## 工具列表

| 工具            | 作用                                   | 需确认 |
| --------------- | -------------------------------------- | ------ |
| **web_search**  | DuckDuckGo 网页搜索，返回标题+URL+摘要 | ❌     |
| **read_file**   | 读取工作区文件，支持行范围             | ❌     |
| **write_file**  | 写入或覆盖工作区文件                   | ⚠ 是   |
| **run_command** | 执行 shell 命令                        | ⚠ 是   |

`⚠ 需确认` 的工具执行前会弹出 `[y/N]` 确认提示。

## 示例

```
You: 搜索 DeepSeek v4 的新特性

🔧 web_search(query="DeepSeek v4 features 2025")
📋 1. DeepSeek-V4: A New Era of AI...
    https://example.com
    深寻科技宣布DeepSeek-V4正式发布...

根据搜索结果，DeepSeek-V4 的主要新特性包括...
```

```
You: 读取 src/config.ts 的前20行

🔧 read_file(path="src/config.ts", endLine=20)
📋   1| import dotenv from "dotenv";
      2| import { fileURLToPath } from "url";
      ...
```

## 项目结构

```
packages/
├── agent/             # 引擎包
│   ├── src/
│   │   ├── config.ts      # 配置加载
│   │   ├── llm.ts         # 流式 API 调用
│   │   ├── agent.ts       # Agent 循环
│   │   ├── session.ts     # 会话持久化
│   │   ├── providers/     # DeepSeek + OpenAI-compatible Provider
│   │   └── tools/
│   │       ├── web-search.ts
│   │       ├── workspace.ts
│   │       └── shell.ts
│   └── tests/         # vitest 测试
│       ├── tools.test.ts
│       └── agent.test.ts
│
└── cli/               # 终端入口
    └── src/index.ts
```

## 运行测试

```bash
cd packages/agent && npx vitest run
# 22 tests passed
```

## 技术栈

- **TypeScript 5.7** — ESM 模块
- **DeepSeek v4-pro** — 默认模型，通过 openai SDK
- **OpenAI-compatible Provider** — 用于接入兼容 Chat Completions 的模型服务
- **Zod** — 工具参数校验 + JSON Schema
- **tsx** — 直接运行 TypeScript（无需编译）
- **Vitest** — 测试框架
- **DuckDuckGo** — 网页搜索（免费、无需 API Key）
