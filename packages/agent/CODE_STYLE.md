# FAgent 代码规范

## 目录

- [命名规范](#命名规范)
- [类型定义](#类型定义)
- [错误处理](#错误处理)
- [模块组织](#模块组织)
- [注释规范](#注释规范)
- [代码格式](#代码格式)

---

## 命名规范

### 文件命名

- 使用 kebab-case: `my-file.ts`
- 工具文件: `tool-name.ts`
- 测试文件: `*.test.ts` / `*.spec.ts`

### 变量/函数命名

| 类型      | 规范                            | 示例                       |
| --------- | ------------------------------- | -------------------------- |
| 变量      | camelCase                       | `userName`, `isLoading`    |
| 常量      | UPPER_SNAKE_CASE                | `MAX_RETRIES`, `API_KEY`   |
| 函数      | camelCase, 动词优先             | `getUser()`, `fetchData()` |
| 类        | PascalCase                      | `Agent`, `ToolRegistry`    |
| 接口/类型 | PascalCase, 可选后缀 `Args`     | `ToolCall`, `ReadFileArgs` |
| 枚举      | PascalCase, 值 UPPER_SNAKE_CASE | `ErrorType.NETWORK`        |
| 私有成员  | 以 `_` 开头或使用 `#`           | `_cache`, `#privateField`  |

### TypeScript 特定

```typescript
// 类型别名: PascalCase
type Config = { ... };
type Handler = (args: Args) => string;

// 接口: PascalCase
interface ToolArgs { ... }
interface StreamCallbacks { ... }

// 泛型: 描述性名称
function createTool<TArgs extends z.ZodTypeAny>() { ... }
```

---

## 类型定义

### 接口 vs 类型别名

```typescript
// 简单类型用 type
type ID = string
type Config = { key: string; value: number }

// 复杂结构用 interface
interface ToolDef<Args extends z.ZodTypeAny> {
  name: string
  handler: (args: z.infer<Args>) => string | Promise<string>
}

// 枚举用 enum
enum ErrorType {
  NETWORK = 'network',
  TIMEOUT = 'timeout',
}
```

### 导出规范

```typescript
// 命名导出 (推荐)
export function getUser(id: string): User { ... }
export const MAX_SIZE = 100;

// 类型导出
export type { User, Config };
export interface { StreamCallbacks };
```

---

## 错误处理

### 错误类规范

```typescript
// 继承 Error, 使用 public 字段
export class AgentError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'AgentError'
  }
}
```

### Try-Catch 规范

```typescript
// ✅ 明确错误类型
try {
  result = await fetchData()
} catch (error) {
  if (error instanceof ValidationError) {
    return 'Invalid input'
  }
  throw error
}

// ❌ 捕获所有错误但不处理
try {
  result = await fetchData()
} catch (e) {
  // ...
}
```

### Error 对象使用

```typescript
// ✅ 使用可选链和可选属性
const errorType = error?.type
const cause = error?.cause

// ❌ 使用 any 类型
const e: any = error
```

---

## 模块组织

### 导入顺序

```typescript
// 1. 内置模块 (node:)
import fs from 'node:fs/promises'
import path from 'node:path'

// 2. 外部包
import OpenAI from 'openai'
import { z } from 'zod'

// 3. 内部模块 (相对路径)
import { Agent } from './agent.js'
import type { ToolCall } from './llm.js'

// 4. 类型导入用 type
import type { Config } from './types.js'
```

### Barrel 导出 (index.ts)

```typescript
// 导出主要功能
export { Agent } from './agent.js'
export { streamAndAccumulate } from './llm.js'

// 导出类型
export type { AgentCallbacks } from './agent.js'
export type { StreamedResponse, ToolCall } from './llm.js'
```

---

## 注释规范

### JSDoc 注释

```typescript
/**
 * 工具注册表，管理所有可用工具的注册和执行
 */
export class ToolRegistry { ... }

/**
 * 读取工作区文件内容
 * @param args.path - 相对于工作区的文件路径
 * @param args.startLine - 起始行号 (可选)
 * @param args.endLine - 结束行号 (可选)
 */
export const readFileTool: ToolDef<ReadFileArgs> = { ... };
```

### 分块注释

```typescript
// ═══════════════════════════════════════════════════
//  Types
// ═══════════════════════════════════════════════════

// ── Config ──
// ── Utils ──
```

### 行内注释

```typescript
// 单行注释前有空格
const result = fn() // 简短说明
```

---

## 代码格式

### 大括号

```typescript
// if/for 等后跟空格
if (condition) {
  // ...
}

for (let i = 0; i < len; i++) {
  // ...
}
```

### 空行使用

```typescript
// 组内成员紧密，组间空一行
function fn1() { ... }
function fn2() { ... }

// 逻辑块间空一行
const a = 1;
const b = 2;

return a + b;
```

### 箭头函数

```typescript
// 始终使用括号包裹参数
const fn = (a, b) => a + b

// 多行时使用大括号
const complex = (a, b) => {
  const result = a + b
  return result * 2
}
```

### 分号

- 不使用分号
- 使用 ESLint 的 `semi: false` 规则

### 引号

- 使用单引号 `'` 代替双引号 `"`
- 特殊情况: 模板字符串或包含单引号的字符串使用反引号

---

## 禁止事项

| 规则             | 说明                                |
| ---------------- | ----------------------------------- |
| 禁止 `any`       | 使用 `unknown` 代替，或定义具体类型 |
| 禁止 `var`       | 始终使用 `const` 或 `let`           |
| 禁止 `==`        | 始终使用 `===`                      |
| 禁止 `require()` | 使用 ESM 的 `import`                |

---

## 工具配置

### ESLint 规则

```javascript
{
  "no-unused-vars": "warn",
  "no-console": "off",
  "@typescript-eslint/no-explicit-any": "warn",
  "@typescript-eslint/explicit-function-return-type": "off",
}
```

### Prettier 配置

```javascript
{
  "printWidth": 100,
  "tabWidth": 2,
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5",
  "arrowParens": "always"
}
```
