# FAgent 代码质量审查规范

## 目录

- [可读性](#1-可读性-readability)
- [健壮性](#2-健壮性-robustness)
- [结构优雅性](#3-结构优雅性-structure)
- [数据结构使用](#4-数据结构使用)
- [运行效率](#5-运行效率-efficiency)
- [审查流程](#审查流程)

---

## 1. 可读性 (Readability)

### 检查标准

| 检查点     | 标准                               | 说明                          |
| ---------- | ---------------------------------- | ----------------------------- |
| 函数长度   | 单函数不超过 50 行                 | 过长则拆分                    |
| 嵌套深度   | 不超过 3 层                        | 使用 early return 减少嵌套    |
| 命名语义化 | 名称表达意图而非实现               | `getUserById()` 而非 `getU()` |
| 注释必要性 | 复杂逻辑必须注释，简单逻辑不需注释 | 业务规则需注释                |
| 空白一致性 | 遵循 Prettier 配置                 | 组间空行、缩进一致            |

### 好/差示例

```typescript
// ❌ 差：深层嵌套
if (user) {
  if (user.isActive) {
    if (user.hasPermission) {
      // 处理逻辑...
    }
  }
}

// ✅ 好：early return
if (!user || !user.isActive || !user.hasPermission) return
// 处理逻辑...

// ❌ 差：函数过长
async function processAll(items) {
  // 100+ 行处理逻辑
}

// ✅ 好：拆分函数
async function processAll(items) {
  const validated = items.filter(validate)
  const results = await Promise.all(validated.map(processOne))
  return aggregate(results)
}
```

---

## 2. 健壮性 (Robustness)

### 检查标准

| 检查点   | 标准                                  | 说明                                     |
| -------- | ------------------------------------- | ---------------------------------------- |
| 空值处理 | 使用可选链 `?.` 和空值合并 `??`       | 避免 `Cannot read property of undefined` |
| 类型安全 | 避免 `any`，使用 `unknown` 或具体类型 | 优先使用 Zod 校验                        |
| 边界检查 | 数组/字符串操作前检查边界             | `arr[0]` 前检查 `arr.length > 0`         |
| 异常处理 | 区分可恢复错误和致命错误              | 非致命错误返回默认值                     |
| 超时控制 | 网络请求必须设置超时                  | `AbortSignal.timeout()`                  |
| 输入校验 | 外部输入必须校验                      | Zod schema 校验                          |

### 好/差示例

```typescript
// ❌ 差：硬编码假设
const name = user.profile.displayName // profile 可能不存在

// ✅ 好：安全访问
const name = user.profile?.displayName ?? 'Anonymous'

// ❌ 差：无边界检查
const result = arr[index]

// ✅ 好：边界检查
const result = arr[index] ?? null

// ❌ 差：无超时
const resp = await fetch(url)

// ✅ 好：带超时
const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) })
```

---

## 3. 结构优雅性 (Structure)

### 检查标准

| 检查点   | 标准                 | 说明                                      |
| -------- | -------------------- | ----------------------------------------- |
| 单一职责 | 一个函数做一件事     | `readFile()` 只读取，`parseFile()` 只解析 |
| 依赖注入 | 外部依赖通过参数注入 | 便于测试                                  |
| 模块耦合 | 同层模块不直接依赖   | 通过接口/事件解耦                         |
| 配置外置 | 常量不硬编码         | 放入 config.ts 或环境变量                 |
| 循环依赖 | 禁止循环 import      | 检查 import 图                            |

### 设计模式使用建议

| 模式     | 适用场景           | 当前项目位置      |
| -------- | ------------------ | ----------------- |
| Registry | 工具注册、插件管理 | `tools/index.ts`  |
| Strategy | 多种算法切换       | 可用于 LLM 调用   |
| Observer | 事件回调           | `AgentCallbacks`  |
| Factory  | 对象创建           | 工具工厂          |
| Builder  | 复杂配置构建       | 可用于 Agent 配置 |

### 好/差示例

```typescript
// ❌ 差：职责混杂
async function processUser(userId) {
  const db = new Database() // 内部创建依赖
  const user = db.find(userId)
  const cache = getCache() // 隐藏依赖
  cache.set(userId, user)
  return user
}

// ✅ 好：依赖注入
async function processUser(userId, db: Database, cache: Cache) {
  const user = db.find(userId)
  cache.set(userId, user)
  return user
}
```

---

## 4. 数据结构使用

### 选择指南

| 数据结构 | 适用场景           | 时间复杂度           |
| -------- | ------------------ | -------------------- |
| `Array`  | 有序列表、顺序访问 | O(1) 访问，O(n) 查找 |
| `Map`    | 键值对、O(1) 查找  | O(1) get/set         |
| `Set`    | 去重、成员检查     | O(1) add/check       |
| `Object` | 固定字段结构       | 字段访问             |
| `string` | 文本处理           | 注意拼接效率         |

### 检查清单

- [ ] 是否使用了正确的数据结构
- [ ] 是否有更高效的数据结构替代方案
- [ ] 是否滥用 `any` 类型掩盖数据结构问题

### 好/差示例

```typescript
// ❌ 差：频繁查找用 Array
const users = [{ id: 1 }, { id: 2 }]
const target = users.find((u) => u.id === id) // O(n)

// ✅ 好：频繁查找用 Map
const users = new Map([
  [1, { id: 1 }],
  [2, { id: 2 }],
])
const target = users.get(id) // O(1)

// ❌ 差：重复计算
if (cache.has(key)) {
  const value = cache.get(key)
  // ...
}

// ✅ 好：直接使用
if (cache.has(key)) {
  return cache.get(key)!
}
```

---

## 5. 运行效率 (Efficiency)

### 时间复杂度

| 操作         | 复杂度 | 注意                      |
| ------------ | ------ | ------------------------- |
| 数组遍历     | O(n)   | 避免嵌套遍历 O(n²)        |
| 字符串拼接   | O(n)   | 大量拼接用 `Array.join()` |
| Map/Set 操作 | O(1)   | 频繁查找用 Map 替代 Array |
| 正则匹配     | O(n)   | 避免在循环内编译正则      |

### 空间复杂度

| 检查点         | 标准                  |
| -------------- | --------------------- |
| 避免复制大对象 | 使用引用或结构共享    |
| 及时释放资源   | 文件流、数据库连接    |
| 缓存策略       | 重复计算结果缓存      |
| 渐进式处理     | 大文件/大数据流式处理 |

### 好/差示例

```typescript
// ❌ 差：循环内字符串拼接
let result = ''
for (const item of items) {
  result += process(item) // O(n²) 复杂度
}

// ✅ 好：数组收集后 join
const results = items.map(process)
return results.join('')

// ❌ 差：循环内编译正则
for (const text of texts) {
  const regex = new RegExp(pattern) // 每次都编译
}

// ✅ 好：循环外编译
const regex = new RegExp(pattern)
for (const text of texts) {
  regex.test(text)
}
```

---

## 审查流程

### 自检清单

```
代码提交前自检:
□ 可读性：函数是否过长？命名是否清晰？
□ 健壮性：空值是否处理？输入是否校验？
□ 结构：职责是否单一？依赖是否清晰？
□ 效率：是否有 O(n²) 问题？
□ 类型安全：是否避免了 any？
```

### 审查维度权重

| 维度   | 权重 | 说明                       |
| ------ | ---- | -------------------------- |
| 正确性 | 30%  | 功能是否正确，边界是否处理 |
| 健壮性 | 25%  | 错误处理、异常恢复         |
| 可读性 | 20%  | 代码可维护性               |
| 效率   | 15%  | 性能影响                   |
| 优雅性 | 10%  | 代码美感                   |

### 审查问题清单

| 维度     | 必问问题                                     |
| -------- | -------------------------------------------- |
| 可读性   | 这个函数能否从名字推断出作用？需要几秒理解？ |
| 健壮性   | 如果输入为空会怎样？如果超时会怎样？         |
| 结构     | 这个函数是否只做一件事？                     |
| 效率     | 这个循环是否可以并行？是否有缓存机会？       |
| 类型安全 | 这里是否使用了 any？为什么？能否具体化？     |
