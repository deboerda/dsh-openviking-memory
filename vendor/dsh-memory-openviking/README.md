# dsh-memory-openviking

Native long-term memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness),
backed by [OpenViking](https://github.com/volcengine/OpenViking) ("Self-evolving Context Database
for AI Agents"). Zero self-built plugin frameworks — the integration rides DSH's native Cordis
composition planes and OpenViking's HTTP surface.

> `dsh-plugin` · **Global** long-term memory: automatic capture, experience/trajectory
> closed-loop, memory tools, profile injection, a WebUI settings card, and first-turn
> injection control for **every** agent preset — no dedicated "memory mode".

## What you get

| Capability | Plane | Scope |
|---|---|---|
| **Automatic capture** — `session/event` (write-behind) → `session/flush` (bounded-await drain) → `batchAddMessages` + async `commitSession` (server-side LLM distillation into preferences/entities/events) | Host (`memory-openviking` row) | **Every session, every preset** |
| **Durability** — retain-on-failure with exponential-backoff retry, on-disk dead-letter queue (`deadLetterDir`), buffer cap for long outages, and a final `keepRecentMessages: 0` commit at `agent/disposed` / `session/disposed` (short sessions and trailing messages are never stranded) | Host | Per session |
| **Memory service** `ctx.memory` — `write / recall / search / profile / forget / commit / health` | Host | Every preset's rows |
| **Thin tools** — `memory_write / memory_recall / memory_search / memory_profile / memory_forget` (forget is restricted to the `memories/` namespace, non-recursive by default, audit-logged) | Global registration (`tool-memory` row) | Every agent (visible unless a preset explicitly restricts global tools) |
| **Automatic `<memory_profile>` prompt injection** — session working-memory overview + cross-session recalled preferences/entities/events, 1200-char budget, 5-min cache, sync provider with async refresh (never blocks prompt assembly); commit-cascade invalidation; injection-safe truncation and tag sanitization | Global (`system-prompt` section) | Every turn of every session |
| **Per-input targeted injection** — `agent/pre-step` reads the current user input, retrieves relevant memories (semantic query + `project=` tag targeting with untagged fallback) and injects one `<memory_context>` clue block; each new turn **surface-replaces** the previous block so history never accumulates; trivial inputs and repeated inputs skip the search | Global (`agent/pre-step` waterfall) | Every turn · ~500-token budget · silent degradation |
| **First-turn injection control** — `firstTurn.skipPresets` (by `session.header.agentPreset`) and/or `firstTurn.skipAllFirstTurn`: the first turn of selected (or every) preset injects **no** memory at all — no `<memory_context>` message and an empty `<memory_profile>` section — then behaves normally from turn 2. Pristine first prompts for minimal/router-style presets | Global (`tool-memory` config) | First turn only |
| **WebUI settings cards** — a plugin configuration card in 设置 → 插件配置 (`settings.plugin.item`) for both packages, matching the official card pattern: connection / isolation / capture / recall groups (memory-openviking) and section / dynamic / first-turn groups (tool-memory), zh + en locale, staged save | Client (`dsh.client` bundle half) | Every browser |
| **OpenViking 0.4.6 compatibility** — recall normalized for the 0.4.6 `SearchRequest` (no `mode`/`max_tokens`/`purpose`/`peer_scope`) and its `memories[]` response shape; verified live against an `auth_mode: api_key` server | Adapter | Recall/search |
| **Experience closed-loop** — extraction, `experiences`/`trajectories`/`cases` evolution, and `used()` reuse ranking all run **inside the OpenViking server** (Agent Evolution). This adapter triggers the commits and tags and forwards recall — the evolution logic itself is not in this repo. | OpenViking server + adapter | Account-wide |
| **Tenant isolation** — `account`/`user` scoping (per-account, per-user API keys) keeps one machine's (or one agent's) memories out of another's recall; optional `peerPerSession` actor peers for finer segmentation | Host | Config |

"Passive tool calls" become "automatic session memory": the model never has to ask to remember —
capture happens on the flush checkpoint (with retry, so it survives a server restart window),
the next session starts with a profile already in its system prompt, and experience reuse is
tracked and fed back into retrieval ranking.

## Architecture

```
┌─ DeepSeek Harness (Cordis runtime) ─────────────────────────────────────┐
│  host composition ($DSH_HOME/profiles/<name>/cordis.patch.yml)         │
│    memory-openviking  → `memory` service (capture + recall)            │
│    tool-memory        → memory_* tools + <memory_profile> section      │
│  browser (Client)                                                      │
│    memory-openviking / tool-memory → WebUI 设置 → 插件配置 cards         │
│  agent plane (ANY preset)  → tools & section inherited globally        │
└───────────────┬────────────────────────────────────────────────────────┘
                │ HTTP (Bearer `X-API-Key`; per-account/per-user tenant keys)
┌───────────────▼────────────────────────────────────────────────────────┐
│ OpenViking server                                                      │
│  viking://user/<user>/memories/{preferences,entities,events,           │
│    experiences,trajectories,cases,tools,skills,...}                    │
│  viking://user/<user>/sessions/dsh-<session>/ (archives + tasks)       │
└────────────────────────────────────────────────────────────────────────┘
```

> **Auth note.** OpenViking >= 0.4.x can run with `auth_mode: api_key`. In that mode a
> **root** key can only reach admin/management APIs; tenant-scoped data APIs (sessions,
> search, write) require a **user/admin API key of an account**. Create an account (and its
> first user) with `POST /api/v1/admin/accounts {"account_id","admin_user_id"}` using the root
> key, then read the returned/inspectable user key. Configure it under `account`/`user`/`apiKey`.

### Generic direction

The research docs in `docs/` lay out the evolution to a **backend-agnostic memory hub**
mirroring DSH's own `dsh-storage` pattern: a `@deepseek-ai/dsh-memory` interface package
(`Memory` hub + `MemoryBackend` contract covering write/read/forget/**tracking**), with this
repo's OpenViking client as one adapter implementation — Mem0/Zep/etc. plug in the same way.
See `docs/dsh-generic-memory-design.md`.

Key implementation facts:

- **Write path** uses the `@openviking/sdk` sessions API (`getSession(autoCreate)` →
  `batchAddMessages` → `commitSession`, async server-side extraction ~10-30s). Since v0.4.0
  the adapter re-ensures the session before every batch/commit, so a server restart can never
  orphan a batch on a missing session.
- **Recall path** uses raw `POST /api/v1/search/search` with context-mode semantics.
- **Commit throttling**: `commitIntervalMessages` (16) or `commitIntervalMs` (60s), growing
  with session length — keeps the server extraction queue from flooding on chatty sessions.

## Install

```powershell
# 1. Copy/install both packages so the DSH loader resolves them (e.g. into the
#    web profile's node_modules), then add two rows to $DSH_HOME/profiles/web/cordis.patch.yml:
- id: memory-openviking
  name: '@deepseek-ai/dsh-memory-openviking'
- id: tool-memory
  name: '@deepseek-ai/dsh-tool-memory'
# 2. OpenViking must be up BEFORE DSH starts.
# 3. Restart DSH.
```

Both packages are plain ESM, zero build step, and include a **browser half** (`client.js`,
declared via `dsh.client` + `exports["./client"]`) so the WebUI configuration cards load
automatically on the next restart.

> **pnpm `file:` copies.** On Windows, pnpm installs a `file:` dependency by **copying** the
> folder rather than symlinking it. If you edit these packages in the source checkout after
> install, re-copy the changed files (`lib/*.js`, `client.js`, `package.json`) into the
> profile's `node_modules` copy — or re-run the install. Do not run a bare `pnpm install` in
> the profile that would also copy/hoist `@deepseek-ai/*` core packages (that creates dual
> module instances and breaks the harness — see the "dual instance" note in the release).

Run the unit tests (fake transport injected; a live server is **not** needed):

```bash
npm install                 # workspace root (also brings dev deps)
node --test "packages/*/test/*.test.js"   # 77 tests
```

## Configuration

### `memory-openviking` row (all optional)

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:18770` | OpenViking server address |
| `apiKey` | — | A **user/admin** API key of an account (root keys can't touch data APIs) |
| `account` / `user` | — | Tenant scoping; set together for per-account/per-user isolation |
| `peerPerSession` | `false` | Map every DSH session to its own OpenViking actor peer |
| `peerScope` | `all` | `all` = every peer, `actor` = current actor only |
| `capture.*` | see Config | `toolResults`, `nonUserSources`, `subagentSessions`, `flushThresholdBytes`, `commitIntervalMessages`, `commitIntervalMs`, `keepRecentMessages`, `maxBufferBytes`, `flushTimeoutMs`, `retryMaxAttempts`, `retryBaseDelayMs`, `retryMaxDelayMs` |
| `recall.*` | see Config | `maxTokens`, `scoreThreshold`, `cacheTtlMs`, `purpose` |
| `timeoutMs` | `15000` | Per-call timeout |
| `deadLetterDir` | `""` | Dead-letter directory for failed batches after retries are exhausted |

### `tool-memory` row (all optional)

| Field | Default | Meaning |
|---|---|---|
| `section.enabled` | `true` | Inject `<memory_profile>` into the system prompt |
| `section.maxChars` | `1200` | Profile block budget |
| `section.minScore` | `0.2` | Min recall score for injected profile entries |
| `section.query` | broad profile query | Cross-session recall query |
| `dynamic.enabled` | `true` | Per-input `<memory_context>` injection |
| `dynamic.minScore` | `0.25` | Min recall score for per-input injection (raise to cut noise) |
| `dynamic.maxEntries` | `5` | Max memories injected per turn (lower to cut noise/tokens) |
| `dynamic.maxTokens` / `inputMaxChars` / `minInputChars` / `projectTagPrefix` | see Config | Budget and tag controls |
| `firstTurn.skipPresets` | `[]` | Preset names (by `session.header.agentPreset`) with **no** memory injection on their first turn |
| `firstTurn.skipAllFirstTurn` | `false` | Skip the first turn for **every** preset |

Worked example for an api_key 0.4.6 server with tenant isolation and low-noise injection:

```yaml
- insert:
    - id: memory-openviking
      name: '@deepseek-ai/dsh-memory-openviking'
      config:
        baseUrl: 'http://192.168.3.205:1933'
        account: 'dsh'
        user: 'main'
        apiKey: '<user-api-key-of-account-dsh>'
    - id: tool-memory
      name: '@deepseek-ai/dsh-tool-memory'
      config:
        firstTurn:
          skipAllFirstTurn: true
          skipPresets: [minimal, router-standard, router-spec]
        dynamic:
          minScore: 0.35
          maxEntries: 3
        section:
          minScore: 0.3
```

## WebUI configuration cards

Both packages ship a browser half that registers a card in **设置 → 插件配置**
(`settings.plugin.item`), styled and structured like the official plugin card:

- **OpenViking long-term memory** (memory-openviking) — Connection (baseUrl / API key /
  account / user / timeout / dead-letter dir), Session isolation (peerPerSession / peerScope),
  collapsible **Auto capture** and **Recall** groups with every capture/recall knob.
- **Memory tools & profile injection** (tool-memory) — collapsible **Profile section**,
  **Per-input injection**, and **First-turn injection control** groups.

Saving stages to the settings layer (which overrides the row config); the host service picks
up changes immediately for new sessions/fresh clients. The API key field is a secret input —
never echoed.

## Fair-use tips (noise, tokens, isolation)

- **Isolate tenants** with `account`/`user` so one machine's (or one agent's) memories don't
  bleed into another's recall — the single biggest noise reducer.
- **Raise `dynamic.minScore`** (e.g. 0.35–0.5) and **lower `dynamic.maxEntries`** (2–3) to
  keep every turn to a few high-confidence clues.
- **`firstTurn.skipAllFirstTurn`** (or per-preset `skipPresets`) gives minimal/router presets
  a pristine first prompt.
- Memories are distilled async (~10–30s after a commit); a freshly `memory_write`'n fact is
  not immediately recallable — that is expected, not a failure.

## Multi-tenant deployments

With no `account`/`user` and `peerPerSession: false`, `peerScope: 'all'`, every DSH session
shares one OpenViking actor — memories leak across users (the service warns at startup).
For isolated deployments set `account`/`user`, `peerPerSession: true` and `peerScope: 'actor'`
for the strictest segmentation, or a dedicated `account`/`user` pair for per-tenant sharing.

## Evaluation

`scripts/memory-eval/` provides a LoCoMo-style benchmark with three layers:

- `run-eval.mjs` — live OpenViking retrieval quality: synthetic multi-turn dataset (with
  shared-token cross-session distractors) → SDK replay with periodic commits → context-mode
  recall scoring, with MRR and precision@5.
- `pipeline-check.mjs` — offline, replays the same dataset through the REAL plugin
  `MemoryService` (fake transport): write-behind, dedup, byte-threshold drains, session
  re-ensure, keepRecent commits, retain-on-failure retry, final commit on disposal, state
  reclamation.
- `token-eval.mjs` — archival storage compression (storage-side) and end-to-end per-request
  prompt overhead.

See `scripts/memory-eval/README.md` and the `docs/` evaluation notes.

## Known limitations

- Recall/search is normalized to the **0.4.6** wire shape this repo was verified against
  (see `packages/dsh-memory-openviking/lib/client.js`); other minor OpenViking versions may
  differ in `SearchRequest` fields or response fields — adjust the normalization there.
- Screen-side install caveat: pnpm `file:` copies the folder on Windows; re-copy edited
  files (see Install).

## License

MIT (packages). OpenViking server is AGPLv3 — this integration talks to it over HTTP only,
never embeds or links server code.
