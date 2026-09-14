/**
 * Unit tests for `@deepseek-ai/dsh-tool-memory` with a fake `memory` service.
 * Run: node --test packages/dsh-tool-memory/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { composeSection, ProfileCache } from "../lib/profile.js";

function makeFakeMemory() {
  return {
    write: async (sessionId, messages) => ({ added: messages.length, sessionId }),
    recall: async (query, opts) => ({
      rendered: `<memory>${query}@${opts.maxTokens}</memory>`,
      entries: [
        { uri: "viking://user/default/memories/preferences/user/theme.md", category: "preferences", score: 0.6, detail: "abstract", text: "- Favorite theme is solarized dark." },
        { uri: "viking://user/default/memories/entities/project/bluefin.md", category: "entities", score: 0.4, detail: "abstract", text: "# Bluefin\n- codename: Bluefin" },
        { uri: "viking://user/default/resources/.overview.md", category: "resources", score: 0.9, detail: "overview", text: "noise" },
      ],
      stats: { used_tokens: 100 },
    }),
    search: async (query, opts) => ({ entries: [{ uri: "u", category: "events", score: 0.5, text: "- x" }], stats: {} }),
    profile: async (sessionId, opts) => ({ overview: `working memory of ${sessionId}`, cached: false, at: Date.now() }),
    forget: async (uri) => ({ removed: uri }),
  };
}

function makeFakeCtx(memory) {
  const sections = [];
  const toolList = [];
  const handlers = {};
  const ctx = {
    memory,
    sections,
    toolList,
    handlers,
    logger: { warns: [], warn(message) { ctx.logger.warns.push(message); } },
    systemPrompt: { section: (section) => sections.push(section) },
    tools: { register: (tool) => toolList.push(tool) },
    get: () => undefined,
    on: (name, fn) => {
      handlers[name] = fn;
    },
    reflect: { provide() {} },
  };
  return ctx;
}

const baseConfig = {
  section: {
    enabled: true,
    maxChars: 1200,
    minScore: 0.2,
    cacheTtlMs: 60000,
    maxTokens: 600,
    includeSessionOverview: true,
    query: "profile query",
  },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("apply registers the five memory tools and guidance section", () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const names = ctx.toolList.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["memory_forget", "memory_profile", "memory_recall", "memory_search", "memory_write"]);
  assert.ok(ctx.sections.some((s) => s.name === "tool:memory"));
  assert.ok(ctx.sections.some((s) => s.name === "memory:profile"));
});

test("profile section disabled removes the injected section only", () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, { ...baseConfig, section: { ...baseConfig.section, enabled: false } });
  assert.ok(ctx.sections.some((s) => s.name === "tool:memory"));
  assert.equal(ctx.sections.some((s) => s.name === "memory:profile"), false);
  assert.equal(ctx.toolList.length, 5, "tools stay registered");
});

test("refresh degrades independently: profile 404 keeps recall entries", async () => {
  const memory = makeFakeMemory();
  memory.profile = async () => {
    throw new Error("NOT_FOUND: session does not exist");
  };
  const ctx = makeFakeCtx(memory);
  apply(ctx, baseConfig);
  const section = ctx.sections.find((s) => s.name === "memory:profile");
  await ctx.handlers["agent/session-start"]({ agent: { id: "sess-d" } });
  await tick();
  const text = section.text({ agent: { id: "sess-d" } });
  assert.ok(text.startsWith("<memory_profile>"), "section still composed from recall alone");
  assert.ok(text.includes("solarized dark"), "recall entries injected despite profile failure");
  assert.ok(!text.includes("session_working_memory"), "overview omitted when profile fails");
});

test("assemble provider returns cached profile text after session-start warm", async () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const section = ctx.sections.find((s) => s.name === "memory:profile");
  const context = { agent: { id: "sess-a" }, scope: { id: "sess-a" } };

  assert.equal(section.text(context), "", "empty before warm");
  await ctx.handlers["agent/session-start"]({ agent: { id: "sess-a" } });
  await tick();
  const text = section.text(context);
  assert.ok(text.startsWith("<memory_profile>"), "composed after warm");
  assert.ok(text.includes("solarized dark"), "preference entry injected");
  assert.ok(text.includes("Bluefin"), "entity entry injected");
  assert.ok(text.includes("working memory of sess-a"), "session overview injected");
  assert.ok(!text.includes("noise"), "non-memory categories filtered out");
});

test("agent/disposed clears the cache", async () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const section = ctx.sections.find((s) => s.name === "memory:profile");
  await ctx.handlers["agent/session-start"]({ agent: { id: "sess-b" } });
  await tick();
  assert.ok(section.text({ agent: { id: "sess-b" } }).length > 0);
  ctx.handlers["agent/disposed"]({ agent: { id: "sess-b" } });
  assert.equal(section.text({ agent: { id: "sess-b" } }), "", "cache dropped at disposal");
});

test("memory_write tool persists through the memory service", async () => {
  const memory = makeFakeMemory();
  const ctx = makeFakeCtx(memory);
  apply(ctx, baseConfig);
  const tool = ctx.toolList.find((t) => t.name === "memory_write");
  const result = await tool.execute({ memory: "prefer pnpm" }, { agent: { id: "sess-w" } });
  assert.equal(result.added, 1);
  assert.equal(result.sessionId, "sess-w");
});

test("memory_recall tool returns the rendered block with budget conversion", async () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const tool = ctx.toolList.find((t) => t.name === "memory_recall");
  const text = await tool.execute({ query: "theme", max_chars: 800 }, { agent: { id: "sess-r" } });
  assert.equal(text, "<memory>theme@200</memory>", "max_chars 800 -> max_tokens 200");
});

test("memory_search returns sliced entries", async () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const tool = ctx.toolList.find((t) => t.name === "memory_search");
  const result = await tool.execute({ query: "events", limit: 1 }, { agent: { id: "sess-s" } });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].category, "events");
});

test("memory_profile tool force-refreshes the cache", async () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const tool = ctx.toolList.find((t) => t.name === "memory_profile");
  const text = await tool.execute({}, { agent: { id: "sess-p" } });
  assert.ok(text.startsWith("<memory_profile>"));
});

test("memory_forget delegates the URI", async () => {
  const memory = makeFakeMemory();
  const ctx = makeFakeCtx(memory);
  apply(ctx, baseConfig);
  const tool = ctx.toolList.find((t) => t.name === "memory_forget");
  const result = await tool.execute({ uri: "viking://user/default/memories/entities/x" }, {});
  assert.equal(result.removed, "viking://user/default/memories/entities/x");
});

// 鈹€鈹€ composeSection (pure) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test("composeSection filters by category and score, caps length", () => {
  const config = { minScore: 0.3, maxChars: 300, includeSessionOverview: true };
  const text = composeSection(
    {
      overview: "session overview",
      entries: [
        { category: "preferences", score: 0.5, text: "- A" },
        { category: "events", score: 0.1, text: "- low score" },
        { category: "skills", score: 0.9, text: "- skill noise" },
      ],
    },
    config,
  );
  assert.ok(text.includes("- A"));
  assert.ok(!text.includes("low score"));
  assert.ok(!text.includes("skill noise"));
  assert.ok(text.length <= 300);
});

test("composeSection returns empty when nothing qualifies", () => {
  assert.equal(composeSection({ overview: "", entries: [{ category: "resources", score: 0.9, text: "x" }] }, { minScore: 0.2, maxChars: 300, includeSessionOverview: true }), "");
});

// 鈹€鈹€ ProfileCache (pure) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

test("ProfileCache: TTL read kicks a background refresh and serves stale", async () => {
  const cache = new ProfileCache({ cacheTtlMs: 50 });
  let calls = 0;
  const refresh = async () => {
    calls += 1;
    return `text-${calls}`;
  };
  assert.equal(cache.read("s1", refresh), "", "cold read empty");
  await tick();
  assert.equal(cache.read("s1", refresh), "text-1");
  await tick();
  // Force staleness: age the entry.
  cache.entries.get("s1").at = Date.now() - 100;
  assert.equal(cache.read("s1", refresh), "text-1", "stale served while refreshing");
  await tick();
  assert.equal(cache.read("s1", refresh), "text-2", "fresh after background refresh");
  assert.equal(calls, 2);
});

test("ProfileCache: explicit refresh propagates, background read never rejects", async () => {
  const cache = new ProfileCache({ cacheTtlMs: 60 });
  const failing = async () => {
    throw new Error("boom");
  };
  await assert.rejects(() => cache.refresh("s1", failing), /boom/, "explicit refresh surfaces errors");
  assert.doesNotThrow(() => cache.read("s1", failing), "background read swallows errors");
  assert.equal(cache.entries.has("s1"), false, "no entry recorded on failure");
});

// ── per-input dynamic injection ────────────────────────────────────────────

import { injectDynamic, userInputText, projectOf, renderMemoryContext, textOf } from "../lib/index.js";

function fakeSurface() {
  return { nodes: [], replaceGeneration: 0 };
}

function fakeSessionWithSurface() {
  const surface = fakeSurface();
  let seq = 100;
  const appends = [];
  return {
    header: { cwd: "C:\\work\\dph-p1" },
    surface,
    appends,
    append(type, data, intent) {
      seq += 1;
      const event = { seq, type, data, intent };
      appends.push(event);
      if (intent?.surfaceOp?.op === "replace") {
        const { start, end } = intent.surfaceOp;
        surface.nodes.splice(start, end - start + 1);
        surface.nodes.push(seq);
        surface.replaceGeneration += 1;
        return event;
      }
      surface.nodes.push(seq);
      return event;
    },
  };
}

function dynamicCtx(memory, session) {
  return { memory, session, logger: { warn() {} } };
}

function dynamicConfig(overrides = {}) {
  return {
    enabled: true,
    maxTokens: 500,
    minScore: 0.25,
    maxEntries: 5,
    inputMaxChars: 500,
    minInputChars: 4,
    projectTagPrefix: "project=",
    ...overrides,
  };
}

function preStepPayload(agent, turn) {
  return { agent, turn, step: 1, signal: undefined };
}

function enterDecision(text) {
  return { kind: "enter", messages: [{ source: { kind: "user" }, content: [{ type: "text", text }] }] };
}

test("textOf flattens text blocks", () => {
  assert.equal(textOf([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(textOf("plain"), "plain");
  assert.equal(textOf([{ type: "tool-call", name: "x" }]), "");
});

test("userInputText joins only direct human messages", () => {
  const messages = [
    { source: { kind: "user" }, content: [{ type: "text", text: "hi" }] },
    { source: { kind: "plugin" }, content: [{ type: "text", text: "notice" }] },
    { source: { kind: "user" }, content: [{ type: "text", text: "again" }] },
  ];
  assert.equal(userInputText(messages), "hi\nagain");
});

test("projectOf derives project name from cwd", () => {
  assert.equal(projectOf("C:\\work\\dph-p1"), "dph-p1");
  assert.equal(projectOf("C:\\work\\dph-p1\\"), "dph-p1");
  assert.equal(projectOf("/home/u/repo"), "repo");
  assert.equal(projectOf(undefined), "");
});

test("renderMemoryContext frames entries as clues with URIs", () => {
  const text = renderMemoryContext(
    [{ category: "preferences", text: "- likes dark theme", uri: "viking://.../theme.md" }],
    dynamicConfig(),
  );
  assert.ok(text.includes("<memory_context>"));
  assert.ok(text.includes("clues only"));
  assert.ok(text.includes("viking://.../theme.md"));
  assert.ok(text.includes("memory_recall"));
});

test("injectDynamic: first turn appends one memory-context message", async () => {
  const memory = {
    search: async (query, opts) => ({
      entries: [{ uri: "u1", category: "preferences", score: 0.6, text: "dark theme" }],
    }),
  };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  const decision = await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("my theme?"), dynamicConfig(), injected);
  assert.equal(decision.kind, "enter", "decision preserved");
  assert.equal(session.appends.length, 1, "one append");
  assert.equal(session.appends[0].intent.surfaceOp, "append");
  assert.equal(session.appends[0].data.source.kind, "memory-context");
  assert.equal(injected.get("s1").turn, 1);
});

test("injectDynamic: same turn is injected once only", async () => {
  const memory = { search: async () => ({ entries: [{ uri: "u1", category: "events", score: 0.5, text: "x" }] }) };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("first"), dynamicConfig(), injected);
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("second"), dynamicConfig(), injected);
  assert.equal(session.appends.length, 1, "turn cached: no second append");
});

test("injectDynamic: next turn replaces the previous injection in place", async () => {
  const memory = { search: async () => ({ entries: [{ uri: "u1", category: "preferences", score: 0.6, text: "x" }] }) };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("first one"), dynamicConfig(), injected);
  const firstSeq = session.appends[0].seq;
  await injectDynamic(ctx, preStepPayload(agent, 2), enterDecision("second two"), dynamicConfig(), injected);
  const second = session.appends[1];
  assert.equal(second.intent.surfaceOp.op, "replace");
  assert.equal(second.intent.surfaceOp.start, second.intent.surfaceOp.end, "single-node replace");
  assert.deepEqual(second.intent.sourceEventSeqs, [firstSeq], "shadows the previous injection");
  assert.equal(session.surface.nodes.length, 1, "surface keeps exactly one injection node");
});

test("injectDynamic: shadowed injection falls back to append", async () => {
  const memory = { search: async () => ({ entries: [{ uri: "u1", category: "events", score: 0.5, text: "x" }] }) };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("first one"), dynamicConfig(), injected);
  session.surface.nodes.length = 0; // compaction shadowed everything
  await injectDynamic(ctx, preStepPayload(agent, 2), enterDecision("second two"), dynamicConfig(), injected);
  assert.equal(session.appends[1].intent.surfaceOp, "append", "falls back to append after shadow");
});

test("injectDynamic: project tag forwarded from session cwd", async () => {
  let seenOpts;
  const memory = {
    search: async (query, opts) => {
      seenOpts = opts;
      return { entries: [{ uri: "u1", category: "entities", score: 0.6, text: "x" }] };
    },
  };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("project thing"), dynamicConfig(), injected);
  assert.deepEqual(seenOpts.tags, ["project=dph-p1"], "project tag from cwd");
  assert.equal(seenOpts.maxTokens, 500);
});

test("injectDynamic: degrades to untagged search when tags match nothing", async () => {
  const calls = [];
  const memory = {
    search: async (query, opts) => {
      calls.push(opts);
      return opts.tags ? { entries: [] } : { entries: [{ uri: "u2", category: "preferences", score: 0.7, text: "fallback hit" }] };
    },
  };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("thing"), dynamicConfig(), injected);
  assert.equal(calls.length, 2, "tagged first, untagged fallback");
  assert.deepEqual(calls[0].tags, ["project=dph-p1"]);
  assert.equal(calls[1].tags, undefined);
  assert.equal(session.appends.length, 1, "fallback result injected");
});

test("injectDynamic: skips without user input or without results", async () => {
  const memory = { search: async () => ({ entries: [] }) };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), { kind: "enter", messages: [] }, dynamicConfig(), injected);
  assert.equal(session.appends.length, 0, "no input -> no injection");
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("query"), dynamicConfig(), injected);
  assert.equal(session.appends.length, 0, "no entries -> no injection");
});

test("injectDynamic: inputs below minInputChars skip the search entirely", async () => {
  let calls = 0;
  const memory = { search: async () => { calls += 1; return { entries: [{ uri: "u", category: "events", score: 0.5, text: "x" }] }; } };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("q"), dynamicConfig({ minInputChars: 4 }), injected);
  assert.equal(calls, 0, "no search for trivial input");
  assert.equal(session.appends.length, 0, "nothing injected");
});

test("injectDynamic: identical consecutive input reuses the cached snapshot (one search)", async () => {
  let calls = 0;
  const memory = {
    search: async () => {
      calls += 1;
      return { entries: [{ uri: "u1", category: "events", score: 0.5, text: "x" }] };
    },
  };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("rerun the test"), dynamicConfig(), injected);
  await injectDynamic(ctx, preStepPayload(agent, 2), enterDecision("rerun the test"), dynamicConfig(), injected);
  assert.equal(calls, 1, "second identical input reused the snapshot");
  assert.equal(session.appends.length, 2, "surface still replaced each turn");
  assert.equal(session.appends[1].intent.surfaceOp.op, "replace");
});

test("injectDynamic: search failure degrades silently", async () => {
  const memory = { search: async () => { throw new Error("down"); } };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  const decision = await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("query"), dynamicConfig(), injected);
  assert.equal(decision.kind, "enter");
  assert.equal(session.appends.length, 0);
});

test("injectDynamic: non-enter decisions pass through untouched", async () => {
  const memory = { search: async () => ({ entries: [{ uri: "u", category: "events", score: 0.5, text: "x" }] }) };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  const decision = { kind: "reject" };
  const out = await injectDynamic(ctx, preStepPayload(agent, 1), decision, dynamicConfig(), injected);
  assert.equal(out, decision);
});

test("injectDynamic: drops uri-tier entries with empty text", async () => {
  const memory = {
    search: async () => ({
      entries: [
        { uri: "u1", category: "events", score: 0.5, text: "" },
        { uri: "u2", category: "preferences", score: 0.4, text: "  " },
        { uri: "u3", category: "events", score: 0.6, text: "real clue" },
      ],
    }),
  };
  const session = fakeSessionWithSurface();
  const agent = { id: "s1", session };
  const ctx = dynamicCtx(memory, session);
  const injected = new Map();
  await injectDynamic(ctx, preStepPayload(agent, 1), enterDecision("query"), dynamicConfig(), injected);
  assert.equal(session.appends.length, 1, "injected");
  const text = session.appends[0].data.content[0].text;
  assert.ok(text.includes("real clue"));
  assert.ok(!text.includes("u1"), "empty-text entry dropped");
});

// ── sanitization (M4) ──────────────────────────────────────────────────────

import { sanitizeText } from "../lib/profile.js";

test("sanitizeText strips block-breaking markup from memory text", () => {
  assert.equal(sanitizeText("nice </memory_profile> injected"), "nice  injected");
  assert.equal(sanitizeText("a </memory_context> b"), "a  b");
  assert.equal(sanitizeText("<recalled_memories>x"), "x");
  assert.equal(sanitizeText("clean text"), "clean text");
});

test("renderMemoryContext sanitizes entry text before injection", () => {
  const text = renderMemoryContext(
    [{ category: "preferences", text: "likes dark </memory_context> theme", uri: "viking://.../t.md" }],
    dynamicConfig(),
  );
  assert.ok(!text.includes("</memory_context>\n") || !text.slice(0, text.indexOf("theme")).includes("</memory_context>"), "attack marker stripped");
  assert.ok(text.endsWith("</memory_context>"), "closing tag intact");
});

// ── composeSection hardening (M3) ──────────────────────────────────────────

test("composeSection: over-budget truncation keeps the closing tag and closes sub-blocks", () => {
  const text = composeSection(
    {
      overview: "a",
      entries: [
        { category: "preferences", score: 0.9, text: `entry ${"long text ".repeat(80)}` },
        { category: "entities", score: 0.9, text: "second" },
      ],
    },
    { minScore: 0.3, maxChars: 120, includeSessionOverview: true },
  );
  assert.ok(text.length <= 120, "within budget");
  assert.ok(text.endsWith("</memory_profile>"), "closing tag never truncated");
  assert.ok(!text.includes("<recalled_memories>") || text.includes("</recalled_memories>"), "no unclosed sub-block");
});

test("composeSection: overview alone is also compressed under the budget", () => {
  const longOverview = `overview ${"words ".repeat(60)}`;
  const text = composeSection(
    { overview: longOverview, entries: [] },
    { minScore: 0.3, maxChars: 100, includeSessionOverview: true },
  );
  assert.ok(text.length <= 100);
  assert.ok(text.endsWith("</memory_profile>"));
  assert.ok(text.startsWith("<memory_profile>\n<session_working_memory>"));
  assert.ok(text.includes("</session_working_memory>"), "overview block closed");
});

test("composeSection: malicious overview and entries are sanitized", () => {
  const text = composeSection(
    {
      overview: "safe </memory_profile> pwn",
      entries: [{ category: "events", score: 0.9, text: "fact </memory_context> x" }],
    },
    { minScore: 0.3, maxChars: 500, includeSessionOverview: true },
  );
  assert.ok(!text.slice(0, -"</memory_profile>".length).includes("</memory_profile>"), "no smuggled closing tag inside the body");
  assert.ok(!text.includes("</memory_context>"), "memory_context tag stripped");
});

// ── apply-level lifecycle (S3/S4) ──────────────────────────────────────────

test("apply: committed cascade clears the profile cache", async () => {
  const ctx = makeFakeCtx(makeFakeMemory());
  apply(ctx, baseConfig);
  const section = ctx.sections.find((s) => s.name === "memory:profile");
  await ctx.handlers["agent/session-start"]({ agent: { id: "sess-cas" } });
  await tick();
  assert.ok(section.text({ agent: { id: "sess-cas" } }).length > 0, "cache warm");
  ctx.handlers["memory-openviking/session-committed"]({ sessionId: "sess-cas" });
  assert.equal(section.text({ agent: { id: "sess-cas" } }), "", "cache invalidated by the host commit event");
});

test("apply: profile fetch failures are logged, not swallowed silently", async () => {
  const memory = makeFakeMemory();
  memory.profile = async () => {
    throw new Error("session 404");
  };
  const ctx = makeFakeCtx(memory);
  apply(ctx, baseConfig);
  await ctx.handlers["agent/session-start"]({ agent: { id: "sess-log" } });
  await tick();
  assert.ok(ctx.logger.warns.some((w) => w.includes("profile fetch failed")), "profile failure logged");
  assert.ok(ctx.logger.warns.some((w) => w.includes("session 404")), "error detail logged");
});

test("apply: agent/disposed clears dynamic injection bookkeeping", async () => {
  const memory = {
    search: async () => ({ entries: [{ uri: "u1", category: "events", score: 0.5, text: "x" }] }),
  };
  const ctx = makeFakeCtx(memory);
  const session = fakeSessionWithSurface();
  apply(ctx, { ...baseConfig, dynamic: dynamicConfig() });
  const agent = { id: "sess-dyn", session };
  const decision = { kind: "enter", messages: [{ source: { kind: "user" }, content: [{ type: "text", text: "hello memory" }] }] };
  await ctx.handlers["agent/pre-step"]({ agent, turn: 1, step: 1, signal: undefined }, async () => decision);
  assert.equal(session.appends[0].intent.surfaceOp, "append", "first injection appended");
  ctx.handlers["agent/disposed"]({ agent });
  await ctx.handlers["agent/pre-step"]({ agent, turn: 2, step: 1, signal: undefined }, async () => decision);
  assert.equal(session.appends[1].intent.surfaceOp, "append", "bookkeeping cleared: fresh append instead of replace");
});

test("firstTurn.skipPresets: no injection on turn 1, profile empty, resumes turn 2", async () => {
  const memory = makeFakeMemory();
  const ctx = makeFakeCtx(memory);
  const session = fakeSessionWithSurface();
  session.header.agentPreset = "router-spec";
  apply(ctx, { ...baseConfig, dynamic: dynamicConfig(), firstTurn: { skipPresets: ["router-spec"] } });
  const agent = { id: "sess-ft", session };
  const decision = enterDecision("hello memory");
  // turn 1 on a skip-preset: no memory-context message, empty profile section
  await ctx.handlers["agent/pre-step"](preStepPayload(agent, 1), async () => decision);
  assert.equal(session.appends.length, 0, "no memory-context on first turn");
  const section = ctx.sections.find((s) => s.name === "memory:profile");
  assert.ok(section, "profile section registered");
  assert.equal(section.text({ agent }), "", "profile empty on suppressed first turn");
  // turn 2: injection resumes
  await ctx.handlers["agent/pre-step"](preStepPayload(agent, 2), async () => decision);
  assert.equal(session.appends.length, 1, "memory-context injected from turn 2");
});

test("firstTurn.skipPresets: unrelated presets are not suppressed", async () => {
  const memory = makeFakeMemory();
  const ctx = makeFakeCtx(memory);
  const session = fakeSessionWithSurface();
  session.header.agentPreset = "standard";
  apply(ctx, { ...baseConfig, dynamic: dynamicConfig(), firstTurn: { skipPresets: ["router-spec"] } });
  const agent = { id: "sess-other", session };
  const decision = enterDecision("hello memory");
  await ctx.handlers["agent/pre-step"](preStepPayload(agent, 1), async () => decision);
  assert.equal(session.appends.length, 1, "non-listed preset is injected on turn 1");
});

test("firstTurn.skipAllFirstTurn: suppresses turn 1 for every preset, resumes turn 2", async () => {
  const memory = makeFakeMemory();
  const ctx = makeFakeCtx(memory);
  const session = fakeSessionWithSurface();
  session.header.agentPreset = "standard"; // any preset
  apply(ctx, { ...baseConfig, dynamic: dynamicConfig(), firstTurn: { skipAllFirstTurn: true } });
  const agent = { id: "sess-all", session };
  const decision = enterDecision("hello memory");
  await ctx.handlers["agent/pre-step"](preStepPayload(agent, 1), async () => decision);
  assert.equal(session.appends.length, 0, "no injection on turn 1 with skipAllFirstTurn");
  await ctx.handlers["agent/pre-step"](preStepPayload(agent, 2), async () => decision);
  assert.equal(session.appends.length, 1, "injection resumes from turn 2");
});

test("memory_forget: recursive flag forwarded to the host service", async () => {
  const memory = makeFakeMemory();
  let seen;
  memory.forget = async (uri, opts) => {
    seen = { uri, opts };
    return { removed: uri };
  };
  const ctx = makeFakeCtx(memory);
  apply(ctx, baseConfig);
  const tool = ctx.toolList.find((t) => t.name === "memory_forget");
  const result = await tool.execute({ uri: "viking://user/default/memories/events/2026", recursive: true }, {});
  assert.deepEqual(seen, { uri: "viking://user/default/memories/events/2026", opts: { recursive: true } });
  assert.equal(result.recursive, true);
});
