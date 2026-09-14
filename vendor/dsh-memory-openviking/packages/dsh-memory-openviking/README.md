# @deepseek-ai/dsh-memory-openviking

DSH 宿主平面记忆服务（Host-plane memory service）。为 DeepSeek Harness 提供
基于本机 OpenViking 的长期记忆：**会话自动捕获**（write-behind + 重试 + 死信
+ 终局提交）+ 召回/画像原语。

## 能力

- **自动捕获**：订阅 `session/event`（用户/助手消息），批量写入 OpenViking
  并触发服务端记忆抽取（preferences/entities/events 分层，LLM 蒸馏）。
  无需显式调用工具。
- **持久性保证（v0.4.0）**：
  - 失败**保留缓冲**：`batchAddMessages` 失败不清空缓冲，按指数退避重试
    （`retryBaseDelayMs` × 2^n，上限 `retryMaxDelayMs`，最多
    `retryMaxAttempts` 次）；
  - 重试耗尽后消息**死信**到 `deadLetterDir/deadletter.jsonl`（未配置则
    warn 后丢弃，绝不静默）；
  - 缓冲上限 `maxBufferBytes`（服务器长时间宕机时丢最旧消息，同样先死信）；
  - **终局提交**：`agent/disposed` / `session/disposed` 触发
    `keepRecentMessages: 0` 的最终 commit——短会话与末尾消息不再断档；
  - 每次批量写入前 `getSession(autoCreate)` 确保会话存在（服务器重启后
    批量不会因会话缺失而孤儿化）。
- **`memory` 服务 API**（消费方注入 `['memory']`）：
  - `write(sessionId, messages)` — 显式写入
  - `recall(query, {maxTokens, sessionId, peerScope, tags, ...})` —
    context-mode 召回，返回 `{rendered, entries, stats}`；`tags` 做
    `project=` 定向过滤（OpenViking 0.4.13 context 模式已验证支持）
  - `search(query, opts)` — 结构化条目（含 URI/score/category）
  - `profile(sessionId, {cacheTtlMs})` — 会话工作记忆概览（带缓存）
  - `commit(sessionId)` — **强制**提交（空缓冲也会 commit 已入库的
    pending 消息，M2 修复）
  - `forget(uri, {recursive})` — 仅接受 `viking://…/memories/` 命名空间，
    默认非递归，审计日志
  - `health()`
- **失败降级**：OpenViking 不可用时仅 warn（每会话一次，成功后重置），
  不阻塞会话循环；`session/flush` 的最长网络等待由 `flushTimeoutMs`
  封顶（默认 2s，drain 在后台继续）。
- **级联失效**：每次成功 commit 后发出 `memory-openviking/session-committed`
  事件，下游缓存（tool-memory 的画像缓存）据此失效，不再有最长 5 分钟的
  陈旧窗口。
- **自注入防护**：`source.kind === 'memory-context'` 的注入消息**永远**
  不被捕获（即使开启 `nonUserSources`），防止记忆自我污染。
- **资源回收**：`session/disposed` 在 drain 链收敛后回收 per-session 状态
  （Map 无界增长修复）；非捕获子代理会话不再创建状态。

## 挂载

```yaml
# $DSH_HOME/cordis.patch.yml（host 平面，所有 profile 生效）
- id: memory-openviking
  name: '@deepseek-ai/dsh-memory-openviking'
  config:
    baseUrl: 'http://127.0.0.1:18770'
```

包需可被 profile 解析：运行 `scripts/dsh-install-memory-packages.ps1`
（在 `profiles/web/package.json` 加 file: 依赖并安装）。改配置后需重启 DSH。

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:18770` | OpenViking 服务地址 |
| `apiKey` / `account` / `user` | — | 生产多租户模式用（dev 模式免认证） |
| `peerPerSession` | `false` | 每 DSH 会话映射独立 OpenViking actor peer |
| `peerScope` | `all` | 召回范围 `all` \| `actor` |
| `capture.toolResults` | `false` | 是否捕获工具结果消息 |
| `capture.nonUserSources` | `false` | 是否捕获注入型用户消息（skill 内容等） |
| `capture.subagentSessions` | `false` | 是否捕获子代理会话 |
| `capture.flushThresholdBytes` | `4096` | 缓冲字符数超限提前 drain |
| `capture.commitIntervalMessages` | `16` | 累计消息数触发记忆抽取 commit |
| `capture.commitIntervalMs` | `60000` | commit 基础最小间隔（防抽取队列洪泛）；会话变长后按 `addedTotal` 自动放大（每次 commit 会重抽整个会话归档） |
| `capture.keepRecentMessages` | `4` | commit 时保留的最近未归档消息数（终局 commit 用 0） |
| `capture.maxBufferBytes` | `262144` | 宕机时保留缓冲的硬上限 |
| `capture.flushTimeoutMs` | `2000` | `session/flush` 最长网络等待（0 = 等完） |
| `capture.retryMaxAttempts` | `8` | 失败重试上限（之后死信/丢弃） |
| `capture.retryBaseDelayMs` | `1000` | 退避基数（×2^n） |
| `capture.retryMaxDelayMs` | `60000` | 退避封顶 |
| `deadLetterDir` | `''` | 死信目录（'' = 不落盘，仅 warn） |
| `recall.maxTokens` | `1600` | context 召回 token 预算（64..32000） |
| `recall.scoreThreshold` | — | 召回分数下限 |
| `recall.cacheTtlMs` | `300000` | profile 缓存 TTL |
| `timeoutMs` | `15000` | HTTP 超时 |

> **多租户警告**：未配置 `account`/`user` 且 `peerPerSession=false`、
> `peerScope='all'` 时，所有 DSH 会话共享一个 OpenViking actor——多用户
> 部署下记忆会互串。启动时会对此组合打 warn 日志。生产多租户请设置
> `account`/`user` + `peerPerSession: true` + `peerScope: 'actor'`。

## 实现要点（事实基线）

- 写路径：`@openviking/sdk` sessions API（`getSession(autoCreate)` →
  `batchAddMessages` → `commitSession` 异步抽取）。
- 召回路径：**裸 fetch `POST /api/v1/search/search {mode:"context"}`**
  ——SDK 0.1.0 的 find/search（list 模式）返回不了提取出的事实叶子。
  `tags` 过滤在 context 模式同样生效（0.4.13 实测：带 tag 查询只返回
  带该 tag 的条目；v0.4.0 之前 client 漏转发 `tags`，项目定向静默失效，
  已修复并有单测）。
- OpenViking 会话 id = `dsh-<DSH会话id>`；dev 模式 account/user 均为 `default`。
- 记忆抽取/经验演化逻辑全部在 OpenViking **服务端**（Agent Evolution）；
  本包只负责触发 commit、转发 recall/tags 与上报 `used()`。

## 依赖策略（E2）

`@deepseek-ai/cordis` / `@deepseek-ai/schemastery` 为 **peerDependencies**
（由 DSH 宿主提供，避免插件内出现第二份 cordis 导致 Service instanceof
断裂）；`@openviking/sdk` 为本包自有依赖。开发期版本走 devDependencies。

## 测试

```bash
node --test packages/dsh-memory-openviking/test/
```

fake fetch 注入（SDK `ClientConfig.fetch`），无需真实服务。33 个用例覆盖：
pickEvent 过滤（含自注入排除）、串行 drain、失败保留+重试+死信、终局提交
（keepRecent 0）、状态回收、强制 commit、forget 命名空间校验、commit 级联
事件、tag 转发。
