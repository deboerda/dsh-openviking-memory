# @deepseek-ai/dsh-tool-memory

Agent preset 工具包：消费宿主 `memory` 服务（`@deepseek-ai/dsh-memory-openviking`），
提供 5 个薄记忆工具 + 自动画像 prompt 注入 + 按输入定向注入。

## 工具

| 工具 | 用途 |
|---|---|
| `memory_write` | 显式写入一条事实/偏好 |
| `memory_recall` | 按主题召回扁平记忆块（`{query, max_chars?}`） |
| `memory_search` | 结构化检索（category/score/uri 条目列表） |
| `memory_profile` | 查看当前注入的画像段全文（强制刷新缓存） |
| `memory_forget` | 按 `viking://` URI 删除记忆（**必须**在 `memories/` 命名空间下；`recursive` 默认 false；宿主审计日志） |

## 自动画像注入

`system-prompt/assemble` 阶段注入 `memory:profile` 段（同步提供器 + 异步缓存
刷新，绝不在装配路径上做网络等待）：

- 内容 = 本会话工作记忆概览（`memory.profile`）+ 跨会话召回过滤后的
  preferences/entities/events/experiences 条目；
- 默认预算 1200 字符、最低分数 0.2、TTL 5 分钟；
- `agent/session-start` 预热缓存，`agent/disposed` 清理；
- **commit 级联失效**：宿主每次成功 commit 发 `memory-openviking/session-committed`，
  本包立即清对应会话缓存——不再有 commit 后最长 5 分钟的陈旧概览（S4 修复）；
- **降级独立**：profile 404 不影响 recall 条目注入，且两路失败都打
  `tool-memory: … fetch failed` 日志（不再静默吞错）。

### 截断与安全（v0.4.0）

- 预算超限时**内容级收缩**（按词边界、UTF-16 安全）：先裁召回条目、再裁
  概览（概览不再豁免预算）；`</memory_profile>` 与各子块闭合标签永远完整，
  不会产出未闭合子块；
- 所有注入文本经 `sanitizeText` 消毒：记忆里写
  `</memory_profile>` / `</memory_context>` 等标签**无法**提前闭合注入块
  （跨会话提示注入缓解）。

## 按输入定向注入（`dynamic.*`）

`agent/pre-step` 瀑布流里读取当前直接用户输入：

1. 语义检索 + `project=<cwd目录名>` 标签定向（tag 无结果时降级为无 tag
   检索）；标签现在真正转发到 context 检索（v0.4.0 修复了 client 漏传）；
2. 过滤记忆类别 + 剔除空文本条目，注入一条 `<memory_context>` 线索块；
3. 每轮 **surface-replace** 上一条注入，历史永远只有一条，不累积；
4. 成本控制：`minInputChars`（默认 4）以下的琐碎输入不检索；与上一轮
  完全相同的输入复用缓存快照（不重复付费一轮同步检索）；
5. 检索失败静默降级（warn），永不阻塞 pre-step。

配置：`dynamic.{enabled,maxTokens(500),minScore(0.25),maxEntries(5),
inputMaxChars(500),minInputChars(4),projectTagPrefix("project=")}`。

**已知开销（每请求）**：5 个工具的 JSON schema + 画像段（约 300 token 估算）
+ 触发注入时再加注入块（≤500 token）。数值口径见
`scripts/memory-eval/token-eval.mjs`（真实测量工具 schema）。

## 挂载（**全局**：所有 preset 自动获得）

```yaml
# $DSH_HOME/cordis.patch.yml（host 平面，与 memory-openviking 并列）
- id: memory-openviking
  name: '@deepseek-ai/dsh-memory-openviking'
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
```

host 平面的 `ctx.tools.register` / `ctx.systemPrompt.section` 是 **global
注册**：工具与画像段对所有 preset 的会话可见（`dsh-tools`：scoped
registrations shadow globals；global 默认全可见，除非某 preset 显式
restrict）。无需为每个模式复制行。`memory-guide` 使用说明在全局技能根
`~/.dsh/skills/memory-guide/`。

## 配置项（`section.*`）

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 是否注入 `memory:profile` 段 |
| `maxChars` | `1200` | 段总字符预算 |
| `minScore` | `0.2` | 注入条目的最低召回分数 |
| `cacheTtlMs` | `300000` | 段缓存 TTL |
| `maxTokens` | `600` | 广谱画像召回 token 预算 |
| `includeSessionOverview` | `true` | 是否包含会话工作记忆概览 |
| `query` | 广谱画像查询 | 跨会话召回用的查询文本 |

## 依赖策略（E2）

`@deepseek-ai/dsh-llm` / `@deepseek-ai/dsh-tools` / `@deepseek-ai/schemastery`
为 **peerDependencies**（DSH 宿主提供同一份实例）；开发期版本走
devDependencies。

## 测试

```bash
node --test packages/dsh-tool-memory/test/
```

fake `memory` 服务驱动，无需真实服务。39 个用例覆盖：5 工具注册、独立降级
+ 日志、缓存 TTL/单飞、commit 级联清缓存、disposed 清理注入簿记、截断保持
闭合标签、恶意标签消毒、项目标签转发、同输入复用、minInputChars 跳过、
forget 递归参数。
