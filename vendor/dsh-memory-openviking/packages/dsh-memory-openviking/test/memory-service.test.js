/**
 * Unit tests for `@deepseek-ai/dsh-memory-openviking`. No live server needed:
 * the SDK transport is driven by an injected fake fetch that records calls.
 * Run: node --test packages/dsh-memory-openviking/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryService, pickEvent, errorMessage } from "../lib/service.js";

/** Minimal Cordis ctx capturing event handlers, emits, and timers. */
function makeFakeCtx() {
  const ctx = {
    handlers: {},
    emits: [],
    logger: { warn() {}, info() {} },
    on(name, fn) {
      ctx.handlers[name] = fn;
    },
    emit(name, ...args) {
      ctx.emits.push({ name, args });
    },
    setTimeout(fn, ms) {
      return setTimeout(fn, ms);
    },
    reflect: { provide() {} },
  };
  return ctx;
}

/** Fake fetch satisfying the SDK transport contract, recording every call. */
function makeFakeFetch(record) {
  const calls = [];
  record.calls = calls;
  return async (url, init = {}) => {
    const entry = {
      url: String(url),
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers ?? {}).entries()),
      body: init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(entry);
    let result = {};
    if (String(url).endsWith("/health")) result = true;
    if (String(url).endsWith("/api/v1/search/search")) {
      // 0.4.6 search response shape: memories[] with abstract + context_type.
      result = {
        memories: [
          {
            uri: "viking://user/agent/memories/preferences/theme.md",
            abstract: "Prefers the dark theme.",
            score: 0.55,
            context_type: "memory",
          },
        ],
        resources: [],
        skills: [],
        total: 1,
      };
    }
    const envelope = { status: "ok", result };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(envelope),
      json: async () => envelope,
    };
  };
}

function fakeSession(id, header = {}) {
  return { id, header, events: [] };
}

function userEvent(seq, text, sourceKind = "user") {
  return {
    seq,
    type: "user/message",
    data: {
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: sourceKind },
    },
  };
}

function assistantEvent(seq, text) {
  return {
    seq,
    type: "assistant/message",
    data: { message: { role: "assistant", content: [{ type: "text", text }] } },
  };
}

function toolResultEvent(seq, text) {
  return {
    seq,
    type: "tool/result",
    data: { message: { role: "user", content: [{ type: "text", text }] } },
  };
}

function baseConfig(overrides = {}) {
  return {
    baseUrl: "http://127.0.0.1:18770",
    peerPerSession: false,
    peerScope: "all",
    capture: {
      toolResults: false,
      nonUserSources: false,
      subagentSessions: false,
      flushThresholdBytes: 4096,
      commitIntervalMessages: 16,
      commitIntervalMs: 60000,
      keepRecentMessages: 4,
      maxBufferBytes: 262144,
      flushTimeoutMs: 2000,
      retryMaxAttempts: 8,
      retryBaseDelayMs: 1000,
      retryMaxDelayMs: 60000,
    },
    recall: { maxTokens: 1600, cacheTtlMs: 300000 },
    timeoutMs: 15000,
    deadLetterDir: "",
    ...overrides,
  };
}

function makeService(config = {}) {
  const record = {};
  const ctx = makeFakeCtx();
  const service = new MemoryService(ctx, baseConfig({ fetch: makeFakeFetch(record), ...config }));
  return { service, ctx, record };
}

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

// ── pickEvent filtering ────────────────────────────────────────────────────

test("pickEvent: direct user messages are captured", () => {
  const picked = pickEvent(userEvent(1, "hello"), { nonUserSources: false, toolResults: false });
  assert.deepEqual(picked, { role: "user", content: "hello" });
});

test("pickEvent: plugin-source user messages skipped by default", () => {
  const picked = pickEvent(userEvent(1, "notice", "plugin"), { nonUserSources: false, toolResults: false });
  assert.equal(picked, undefined);
});

test("pickEvent: plugin-source captured with nonUserSources", () => {
  const picked = pickEvent(userEvent(1, "notice", "plugin"), { nonUserSources: true, toolResults: false });
  assert.deepEqual(picked, { role: "user", content: "notice" });
});

test("pickEvent: memory-context self-injection never captured, even with nonUserSources", () => {
  const picked = pickEvent(userEvent(1, "<memory_context>...</memory_context>", "memory-context"), {
    nonUserSources: true,
    toolResults: true,
  });
  assert.equal(picked, undefined);
});

test("pickEvent: assistant messages always captured", () => {
  const picked = pickEvent(assistantEvent(1, "reply"), { nonUserSources: false, toolResults: false });
  assert.deepEqual(picked, { role: "assistant", content: "reply" });
});

test("pickEvent: tool results skipped by default, captured on demand", () => {
  const off = pickEvent(toolResultEvent(1, "out"), { nonUserSources: false, toolResults: false });
  assert.equal(off, undefined);
  const on = pickEvent(toolResultEvent(1, "out"), { nonUserSources: false, toolResults: true });
  assert.deepEqual(on, { role: "user", content: "out" });
});

test("pickEvent: empty text never captured", () => {
  const picked = pickEvent(
    { seq: 1, type: "assistant/message", data: { message: { content: [{ type: "text", text: "" }] } } },
    { nonUserSources: false, toolResults: false },
  );
  assert.equal(picked, undefined);
});

test("pickEvent: non-message events ignored", () => {
  const picked = pickEvent({ seq: 1, type: "turn/start", data: { turn: 1 } }, { nonUserSources: false, toolResults: false });
  assert.equal(picked, undefined);
});

// ── capture pipeline ───────────────────────────────────────────────────────

test("capture: buffers events and drains on session/flush; commits only when due", async () => {
  const { service, ctx, record } = makeService({
    capture: { commitIntervalMessages: 2, commitIntervalMs: 0 },
  });
  const session = fakeSession("sess-1");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "user says one"));
  ctx.handlers["session/event"](session, assistantEvent(2, "assistant says two"));
  assert.equal(record.calls.length, 0, "nothing sent before flush");

  await ctx.handlers["session/flush"](session);

  const urls = record.calls.map((c) => c.url);
  const batch = record.calls.find((c) => c.url.includes("/messages/batch"));
  assert.ok(batch, "batchAddMessages was called");
  assert.deepEqual(batch.body.messages, [
    { role: "user", content: "user says one" },
    { role: "assistant", content: "assistant says two" },
  ]);
  assert.ok(urls.some((u) => u.includes("/commit")), "commitSession was called (threshold 2 reached)");
});

test("capture: the OpenViking session is ensured before the first batch", async () => {
  const { service, ctx, record } = makeService();
  const session = fakeSession("sess-ensure");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "hi"));
  await ctx.handlers["session/flush"](session);
  const getIndex = record.calls.findIndex((c) => c.url.includes("/sessions/"));
  const batchIndex = record.calls.findIndex((c) => c.url.includes("/messages/batch"));
  assert.ok(getIndex >= 0, "getSession (create-or-reuse) called");
  assert.ok(batchIndex > getIndex, "batch follows session ensure");
});

test("capture: flush within interval and below threshold does not re-commit", async () => {
  const { service, ctx, record } = makeService(); // defaults: 16 msgs / 60s
  const session = fakeSession("sess-nc");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "first"));
  await ctx.handlers["session/flush"](session);
  assert.ok(record.calls.some((c) => c.url.includes("/commit")), "first flush commits (never committed before)");

  const before = record.calls.length;
  ctx.handlers["session/event"](session, userEvent(2, "second"));
  await ctx.handlers["session/flush"](session);
  assert.ok(record.calls.slice(before).some((c) => c.url.includes("/messages/batch")), "drained at flush");
  assert.equal(record.calls.slice(before).some((c) => c.url.includes("/commit")), false, "no re-commit within interval");
});

test("capture: flush commits when the commit interval has elapsed", async () => {
  const { service, ctx, record } = makeService({
    capture: { commitIntervalMs: 0, commitIntervalMessages: 100 },
  });
  const session = fakeSession("sess-t");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "one"));
  await ctx.handlers["session/flush"](session);
  assert.ok(record.calls.some((c) => c.url.includes("/commit")), "commit after interval elapsed");
});

test("capture: commit interval grows with session length (queue-saturation guard)", async () => {
  // Long session (addedTotal 200 -> effective interval 2x = 120s): 90s since
  // the last commit is NOT enough to re-commit.
  const { service, ctx, record } = makeService({
    capture: { commitIntervalMessages: 16, commitIntervalMs: 60000 },
  });
  const session = fakeSession("sess-grow");
  ctx.handlers["session/created"](session);
  const state = service.states.get("sess-grow");
  state.addedTotal = 200;
  state.lastCommitAt = Date.now() - 90000;
  state.pendingCount = 1;
  ctx.handlers["session/event"](session, userEvent(1, "one"));
  await ctx.handlers["session/flush"](session);
  assert.equal(
    record.calls.some((c) => c.url.includes("/commit")),
    false,
    "long session not re-committed before its stretched interval",
  );

  // Short session keeps the base interval: 90s >= 60s commits.
  const { service: svc2, ctx: ctx2, record: rec2 } = makeService({
    capture: { commitIntervalMessages: 16, commitIntervalMs: 60000 },
  });
  const s2 = fakeSession("sess-grow-short");
  ctx2.handlers["session/created"](s2);
  const st2 = svc2.states.get("sess-grow-short");
  st2.addedTotal = 10;
  st2.lastCommitAt = Date.now() - 90000;
  st2.pendingCount = 1;
  ctx2.handlers["session/event"](s2, userEvent(1, "two"));
  await ctx2.handlers["session/flush"](s2);
  assert.ok(rec2.calls.some((c) => c.url.includes("/commit")), "short session commits at the base interval");
});

test("capture: non-captured subagent sessions create no state and send nothing", async () => {
  const { service, ctx, record } = makeService();
  const child = fakeSession("sess-child", { delegationDepth: 2 });
  ctx.handlers["session/created"](child);
  ctx.handlers["session/event"](child, userEvent(1, "child turn"));
  await ctx.handlers["session/flush"](child);
  assert.equal(record.calls.length, 0, "no capture for subagents by default");
  assert.equal(service.states.size, 0, "no per-session state leaked for skipped sessions");

  const { service: svc2, ctx: ctx2, record: rec2 } = makeService({ capture: { subagentSessions: true } });
  ctx2.handlers["session/created"](child);
  ctx2.handlers["session/event"](child, userEvent(1, "child turn"));
  await ctx2.handlers["session/flush"](child);
  const batch = rec2.calls.find((c) => c.url.includes("/messages/batch"));
  assert.ok(batch, "subagent captured when enabled");
});

test("capture: a state created by a public API call never re-opens capture for skipped subagent sessions", async () => {
  const { service, ctx, record } = makeService(); // subagentSessions: false
  await service.write("sess-child2", [{ role: "user", content: "explicit write" }]);
  const batchesBefore = record.calls.filter((c) => c.url.includes("/messages/batch")).length;
  const child = fakeSession("sess-child2", { delegationDepth: 2 });
  ctx.handlers["session/event"](child, userEvent(1, "child turn"));
  await ctx.handlers["session/flush"](child);
  const batchesAfter = record.calls.filter((c) => c.url.includes("/messages/batch"));
  assert.equal(batchesAfter.length, batchesBefore, "no capture for the subagent session despite existing state");
});

test("capture: byte threshold triggers early drain without commit", async () => {
  const { service, ctx, record } = makeService({
    capture: { flushThresholdBytes: 50 },
  });
  const session = fakeSession("sess-2");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "x".repeat(60)));
  await tick();
  const batch = record.calls.find((c) => c.url.includes("/messages/batch"));
  assert.ok(batch, "early drain happened");
  assert.equal(record.calls.some((c) => c.url.includes("/commit")), false, "no commit on early drain");
});

test("capture: concurrent early drain and flush are serialized, no overlapping HTTP", async () => {
  const { service, ctx, record } = makeService({
    capture: { flushThresholdBytes: 30, flushTimeoutMs: 0, commitIntervalMessages: 100, commitIntervalMs: 600000 },
  });
  const session = fakeSession("sess-serial");
  ctx.handlers["session/created"](session);
  // Slow transport: overlap would be visible in maxInflight.
  let inflight = 0;
  let maxInflight = 0;
  const original = service.states.get("sess-serial").client.addMessages;
  service.states.get("sess-serial").client.addMessages = async (sid, messages) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await tick(5);
    inflight -= 1;
    return original(sid, messages);
  };
  // First event crosses the byte threshold (early drain, fire-and-forget)…
  ctx.handlers["session/event"](session, userEvent(1, "a".repeat(40)));
  // …and immediately more events arrive, then a flush.
  ctx.handlers["session/event"](session, assistantEvent(2, "b".repeat(40)));
  await ctx.handlers["session/flush"](session);
  await tick(30);
  assert.equal(maxInflight, 1, "drains never overlap");
  const batches = record.calls.filter((c) => c.url.includes("/messages/batch"));
  const total = batches.reduce((a, c) => a + (c.body?.messages?.length ?? 0), 0);
  assert.equal(total, 2, "both messages delivered across serialized drains");
});

test("capture: duplicate seqs are deduplicated", async () => {
  const { service, ctx, record } = makeService();
  const session = fakeSession("sess-3");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(5, "once"));
  ctx.handlers["session/event"](session, userEvent(5, "once"));
  await ctx.handlers["session/flush"](session);
  const batch = record.calls.find((c) => c.url.includes("/messages/batch"));
  assert.equal(batch.body.messages.length, 1);
});

test("capture: failed flush retains the buffer and retries until success", async () => {
  const { service, ctx, record } = makeService({
    capture: { retryMaxAttempts: 4, retryBaseDelayMs: 5, retryMaxDelayMs: 20, flushTimeoutMs: 0 },
  });
  const session = fakeSession("sess-retry");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "durable"));
  let addCalls = 0;
  const state = service.states.get("sess-retry");
  state.client.addMessages = async () => {
    addCalls += 1;
    if (addCalls <= 2) throw new Error("server unreachable");
    // Third call succeeds (the real client would ensureSession first).
  };
  await assert.doesNotReject(() => ctx.handlers["session/flush"](session));
  assert.equal(state.buffer.messages.length, 1, "buffer retained after failure (no drop-once)");
  await tick(200); // backoff: 5ms, then 10ms
  assert.equal(state.buffer.messages.length, 0, "buffer cleared only after a successful retry");
  assert.ok(addCalls >= 3, "retries happened (1 initial + 2 backoff attempts)");
  assert.equal(state.attempts, 0, "attempt counter reset after success");
  // The retried drain lands the message; the elapsed commit interval then
  // commits it (pending resets), so the durability chain completes end to end.
  assert.equal(state.pendingCount, 0, "committed after the retried drain landed");
  assert.ok(record.calls.some((c) => c.url.includes("/commit")), "commit followed the recovered drain");
});

test("capture: persistent failure dead-letters to disk after retries are exhausted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-memory-dl-"));
  try {
    const { service, ctx } = makeService({
      deadLetterDir: dir,
      capture: { retryMaxAttempts: 1, retryBaseDelayMs: 5, flushTimeoutMs: 0 },
    });
    const session = fakeSession("sess-dl");
    ctx.handlers["session/created"](session);
    ctx.handlers["session/event"](session, userEvent(1, "doomed forever"));
    service.states.get("sess-dl").client.addMessages = async () => {
      throw new Error("server down");
    };
    await assert.doesNotReject(() => ctx.handlers["session/flush"](session));
    await tick(30);
    const lines = (await readFile(join(dir, "deadletter.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 1, "one dead-lettered message");
    assert.ok(JSON.parse(lines[0]).content === "doomed forever", "message content preserved on disk");
    assert.equal(service.states.get("sess-dl").buffer.messages.length, 0, "buffer released after dead-letter");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("capture: peerPerSession sends the actor peer header", async () => {
  const { service, ctx, record } = makeService({ peerPerSession: true });
  const session = fakeSession("sess-peer");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "hi"));
  await ctx.handlers["session/flush"](session);
  const batch = record.calls.find((c) => c.url.includes("/messages/batch"));
  assert.equal(batch.headers["x-openviking-actor-peer"], "dsh-sess-peer");
});

test("capture: a successful commit invalidates caches and emits the cascade event", async () => {
  const { service, ctx } = makeService({ capture: { commitIntervalMessages: 1 } });
  const session = fakeSession("sess-emit");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "hi"));
  await ctx.handlers["session/flush"](session);
  const event = ctx.emits.find((e) => e.name === "memory-openviking/session-committed");
  assert.ok(event, "commit cascade event emitted");
  assert.equal(event.args[0].sessionId, "sess-emit");
});

// ── lifecycle: final commit + state reclamation ────────────────────────────

test("lifecycle: agent/disposed finalizes with keepRecent 0 (short sessions archived)", async () => {
  const { service, ctx, record } = makeService({
    capture: { commitIntervalMessages: 100, commitIntervalMs: Number.MAX_SAFE_INTEGER },
  });
  const session = fakeSession("sess-final");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "one short turn"));
  await ctx.handlers["session/flush"](session); // drains only (below threshold, within interval)
  const commitsBefore = record.calls.filter((c) => c.url.includes("/commit")).length;
  assert.equal(commitsBefore, 0, "nothing committed before disposal");

  let keepRecent;
  const state = service.states.get("sess-final");
  const original = state.client.commitSession;
  state.client.commitSession = (sid, keep) => {
    keepRecent = keep;
    return original(sid, keep);
  };
  ctx.handlers["agent/disposed"]({ agent: { id: "sess-final" } });
  await tick(30);
  assert.equal(keepRecent, 0, "final commit archives the whole tail (keepRecent 0)");
  assert.equal(state.tailUncommitted, false, "tail flag cleared by the final commit");
});

test("lifecycle: dispose with nothing new skips a pointless final commit", async () => {
  const { service, ctx, record } = makeService({
    capture: { commitIntervalMessages: 1, keepRecentMessages: 0 },
  });
  const session = fakeSession("sess-idle");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "hi"));
  await ctx.handlers["session/flush"](session);
  const commitsBefore = record.calls.filter((c) => c.url.includes("/commit")).length;
  ctx.handlers["agent/disposed"]({ agent: { id: "sess-idle" } });
  await tick(20);
  const commitsAfter = record.calls.filter((c) => c.url.includes("/commit")).length;
  assert.equal(commitsAfter, commitsBefore, "no extra commit when fully flushed+committed");
});

test("lifecycle: session/disposed reclaims per-session state after the chain settles", async () => {
  const { service, ctx } = makeService();
  const session = fakeSession("sess-reap");
  ctx.handlers["session/created"](session);
  ctx.handlers["session/event"](session, userEvent(1, "hi"));
  assert.ok(service.states.has("sess-reap"));
  ctx.handlers["session/disposed"](session);
  await tick(50);
  assert.equal(service.states.has("sess-reap"), false, "state removed after drain chain settled");
});

// ── public API ─────────────────────────────────────────────────────────────

test("recall: search returns normalized entries/rendered and sends only 0.4.6 fields", async () => {
  const { service, record } = makeService();
  const result = await service.recall("which editor", { maxTokens: 500, sessionId: "sess-1" });
  const call = record.calls.find((c) => c.url.includes("/api/v1/search/search"));
  assert.ok(call, "search endpoint hit");
  assert.equal(call.body.query, "which editor");
  assert.equal(call.body.session_id, "sess-1");
  assert.equal(call.body.mode, undefined, "0.4.6 rejects mode (extra_forbidden)");
  assert.equal(call.body.max_tokens, undefined, "0.4.6 rejects max_tokens");
  assert.equal(call.body.peer_scope, undefined, "0.4.6 rejects peer_scope");
  assert.ok(Array.isArray(result.entries), "normalized entries array");
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].category, "preferences", "category derived from the memory URI");
  assert.equal(result.entries[0].text, "Prefers the dark theme.", "abstract mapped to text");
  assert.equal(result.total, 1);
  assert.ok(result.rendered.includes("[preferences] Prefers the dark theme."), "rendered block composed");
  assert.ok(result.stats && typeof result.stats === "object");
});

test("recall: tags are forwarded for project-targeted retrieval", async () => {
  const { service, record } = makeService();
  await service.recall("q", { tags: ["project=dph-p1"] });
  const call = record.calls.find((c) => c.url.includes("/api/v1/search/search"));
  assert.deepEqual(call.body.tags, ["project=dph-p1"]);
});

test("recall: score threshold is forwarded; unsupported purpose/peer_scope dropped", async () => {
  const { service, record } = makeService({ peerScope: "actor", recall: { maxTokens: 800, scoreThreshold: 0.2, purpose: "coding" } });
  await service.recall("q");
  const call = record.calls.find((c) => c.url.includes("/api/v1/search/search"));
  assert.equal(call.body.score_threshold, 0.2);
  assert.equal(call.body.purpose, undefined, "0.4.6 SearchRequest has no purpose");
  assert.equal(call.body.peer_scope, undefined, "0.4.6 SearchRequest has no peer_scope");
});

test("search: returns entries and stats", async () => {
  const { service, record } = makeService();
  const result = await service.search("q");
  assert.ok(Array.isArray(result.entries));
  assert.ok(result.stats && typeof result.stats === "object");
});

test("write: explicit write sends messages and commits at threshold", async () => {
  const { service, record } = makeService({ capture: { commitIntervalMessages: 1 } });
  const result = await service.write("sess-w", [{ role: "user", content: "remember this" }]);
  assert.equal(result.added, 1);
  const batch = record.calls.find((c) => c.url.includes("/messages/batch"));
  assert.deepEqual(batch.body.messages, [{ role: "user", content: "remember this" }]);
  assert.ok(record.calls.some((c) => c.url.includes("/commit")), "commit fired at threshold");
});

test("profile: cached per session with TTL", async () => {
  const { service, record } = makeService();
  const first = await service.profile("sess-p");
  const second = await service.profile("sess-p");
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(record.calls.filter((c) => c.url.includes("/context")).length, 1);
});

test("commit: forces a commit even with an empty buffer (M2)", async () => {
  const { service, record } = makeService({ capture: { commitIntervalMessages: 100, commitIntervalMs: 600000 } });
  const result = await service.commit("sess-force");
  assert.deepEqual(result.drained, { added: 0 });
  assert.equal(record.calls.some((c) => c.url.includes("/commit")), false, "never-added session is not committed");
  await service.write("sess-force", [{ role: "user", content: "x" }]);
  const before = record.calls.filter((c) => c.url.includes("/commit")).length;
  await service.commit("sess-force");
  const after = record.calls.filter((c) => c.url.includes("/commit")).length;
  assert.equal(after, before + 1, "commit() forces a commit of pending (drained) messages");
});

test("forget: validates the memories namespace and defaults to non-recursive", async () => {
  const { service, record } = makeService();
  assert.throws(() => service.forget("viking://user/default/resources/x"), /memories/);
  assert.throws(() => service.forget("C:\\tmp\\x"), /memories/);
  await service.forget("viking://user/default/memories/entities/x");
  const del = record.calls.find((c) => c.method === "DELETE");
  assert.ok(del, "non-recursive delete issued");
});

test("forget and health delegate to the shared client", async () => {
  const { service, record } = makeService();
  await service.forget("viking://user/default/memories/entities/x");
  assert.ok(record.calls.some((c) => c.method === "DELETE" || c.url.includes("/api/v1/fs")));
  const healthy = await service.health();
  assert.equal(healthy, true);
});

test("errorMessage tolerates unknown shapes", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("plain"), "plain");
});
