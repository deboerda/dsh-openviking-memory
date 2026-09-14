# Changelog

## v0.4.0 — durability & safety hardening (2026-08-15)

Every finding from the independent code review (S/M/E/A) is addressed.

### P0 — data correctness

- **S1 retain-on-failure**: `_drain` no longer clears the buffer before the
  network call. A failed `batchAddMessages` keeps every message queued,
  retries with exponential backoff (`capture.retryMaxAttempts`,
  `retryBaseDelayMs`, `retryMaxDelayMs`), and dead-letters to
  `deadLetterDir/deadletter.jsonl` when retries are exhausted. A buffer cap
  (`capture.maxBufferBytes`) bounds memory during long outages (oldest
  messages are dead-lettered, never silently dropped mid-retry).
- **S2 final commit**: `agent/disposed` and `session/disposed` now finalize
  the session with `keepRecentMessages: 0` — short sessions and the trailing
  `keepRecent` messages are archived and extracted.
- **S3 leaks**: per-session states are reclaimed at `session/disposed`
  (after the drain chain settles); non-captured subagent sessions no longer
  create states; tool-memory's `injected` bookkeeping is cleared at
  `agent/disposed`.
- **S4 cache cascade**: the service emits `memory-openviking/session-committed`
  after every successful commit; tool-memory invalidates its profile cache on
  that event — no more up-to-5-minute stale overview.
- **queue-saturation guard (live finding)**: every OpenViking
  `commitSession` re-extracts the WHOLE session archive, so a long-running
  session committing every 60s saturates the server's extraction queue
  (observed live: 50+ pending `session_commit` tasks from one DSH session).
  The effective commit interval now grows with session length
  (`addedTotal`), while message-threshold commits and the final dispose
  commit are unaffected.

### P1 — consistency / resources / safety

- **M1 serialized drains**: one drain chain per session; early drains and
  flushes can no longer overlap or double-trigger commits.
- **M2 forced commit**: `commit()` now forces a commit even with an empty
  buffer (pending/trailing messages get archived).
- **M3 truncation**: `composeSection` shrinks content at word boundaries
  inside sub-blocks (recalled entries first, then the overview) — the
  `</memory_profile>` closer and every sub-block closer always survive.
- **M4 sanitization**: all injected memory text passes `sanitizeText`
  (strips `</memory_profile>`-style tags) in both the profile section and
  the per-input context block.
- **M5 self-injection guard**: `memory-context` messages are never captured,
  regardless of `capture.nonUserSources`.
- **M6 forget hardening**: `memory_forget` is restricted to
  `viking://…/memories/` URIs, defaults to non-recursive, and every call is
  audit-logged by the host service.
- **M7 multi-tenant**: startup warning when running in shared single-actor
  mode; README multi-tenant section documents `account`/`user` +
  `peerPerSession` + `peerScope: 'actor'`.
- **M8 bounded flush**: `session/flush` waits at most
  `capture.flushTimeoutMs` (2s) for the network; the serialized drain keeps
  running in the background.
- **M9 injection cost**: inputs below `dynamic.minInputChars` skip the
  search; identical consecutive inputs reuse the cached snapshot;
  `token-eval.mjs` now measures the real end-to-end per-request overhead.

### P2 — engineering

- **E1 dead code**: `client.ensureSession` is now wired into `addMessages` /
  `commitSession` (fixes orphaned batches after a server restart);
  `text.js:bytesOf` removed.
- **E2 dependencies**: `@deepseek-ai/cordis`, `schemastery`, `dsh-tools`,
  `dsh-llm` moved to `peerDependencies` (DSH provides the shared instance;
  dev versions via `devDependencies`).
- **E3 logging**: profile/recall degradation paths log the error instead of
  swallowing it.
- **E4 CI + tests**: GitHub Actions CI (`.github/workflows/ci.yml`) runs both
  suites; new tests cover states cleanup, serialized drains, forced commit,
  cache cascade, final commit, dead-letter, tag forwarding, sanitization,
  and injection reuse — 72 tests total.
- **E5 claims**: README now states plainly that extraction/evolution logic
  lives in the OpenViking server; the durability description matches the
  real behavior; the v0.3.0 "project tag targeting" actually forwards `tags`
  now (the parameter was being dropped — fixed, verified live, tested).

### P3 — evaluation methodology

- **A1 strict scoring**: facts carry >= 2 stable tokens; a hit requires ALL
  of them in ONE recalled entry. Lenient scoring kept for comparison, plus
  MRR and precision@5.
- **A2 pipeline check**: `pipeline-check.mjs` replays the dataset through the
  real `MemoryService` offline — the plugin's durability contract is now
  tested, not just the server's retrieval.
- **A3 token accounting**: storage compression and end-to-end prompt
  overhead are measured separately; tool schemas are measured from the real
  package.
- **A4 dataset**: more sessions/turns/facts, larger token pools, varied
  templates, and shared-project cross-session distractors (a token appearing
  in two sessions with different facts).

## v0.3.0 — per-input targeted injection (2026-08-15)

## v0.2.0 — global host-plane memory + tool package (2026-08-15)

## v0.1.0 — initial OpenViking native integration (2026-08-14)
