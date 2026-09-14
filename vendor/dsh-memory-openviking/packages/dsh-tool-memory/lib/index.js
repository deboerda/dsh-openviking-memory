/**
 * `@deepseek-ai/dsh-tool-memory` — agent-preset memory tools over the host
 * `memory` service, plus an automatic compact user-profile prompt section.
 *
 * Preset row:
 * ```yaml
 * - id: tool-memory
 *   name: '@deepseek-ai/dsh-tool-memory'
 * ```
 * Requires the host row `memory-openviking` (`@deepseek-ai/dsh-memory-openviking`).
 * @module @deepseek-ai/dsh-tool-memory
 */

import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
import { MEMORY_CATEGORIES, ProfileCache, composeSection, sanitizeText } from "./profile.js";

export const name = "tool-memory";

export const inject = ["memory", "tools", "systemPrompt"];

/** Settings namespace carrying this plugin's section/dynamic configuration. */
const NS = "tool-memory";

/** Schemastery configuration for the tool-memory row. */
export const Config = z
  .object({
    section: z
      .object({
        /** Inject the `<memory_profile>` section into the system prompt. */
        enabled: z.boolean().default(true),
        maxChars: z.number().default(1200),
        /** Minimum recall score for injected memory entries. */
        minScore: z.number().default(0.2),
        cacheTtlMs: z.number().default(300000),
        maxTokens: z.number().min(64).max(32000).default(600),
        includeSessionOverview: z.boolean().default(true),
        /** Broad profile query used for the cross-session recall. */
        query: z
          .string()
          .default("user profile preferences identity background facts about the user"),
      })
      .default({}),
    dynamic: z
      .object({
        /** Inject per-input relevant memories before each turn (semantic
         * retrieval + project-tag targeting). The conversation surface keeps
         * exactly one injected message: each new turn replaces the previous. */
        enabled: z.boolean().default(true),
        maxTokens: z.number().min(64).max(32000).default(500),
        minScore: z.number().default(0.25),
        maxEntries: z.number().default(5),
        inputMaxChars: z.number().default(500),
        /** Skip trivial inputs below this length (per-turn search costs one
         * synchronous HTTP round-trip). */
        minInputChars: z.number().default(4),
        projectTagPrefix: z.string().default("project="),
      })
      .default({}),
    firstTurn: z
      .object({
        /** Presets (by `session.header.agentPreset`) whose FIRST turn gets NO
         * memory injection at all — no `<memory_context>` message and an empty
         * `<memory_profile>` section. From turn 2 on, injection behaves as
         * normal. Useful for minimal/router presets that want a pristine
         * first-turn prompt (clean routing, RL-shaped first request). */
        skipPresets: z.array(z.string()).default([]),
        /** Skip the first turn for EVERY preset (clean first prompt globally). */
        skipAllFirstTurn: z.boolean().default(false),
      })
      .default({}),
  })
  .default({});

const GUIDANCE =
  "Use memory tools to persist and recall long-term context across sessions. memory_write stores a fact explicitly; memory_recall returns a flat recalled-memory block for the current topic; memory_search returns structured entries with scores and URIs; memory_profile shows the injected profile section; memory_forget removes a stored memory by its viking:// URI. A compact <memory_profile> section (preferences, entities, events) is injected into every turn automatically — prefer it over re-asking the user.";

/** Resolve the calling session id from tool execution metadata. */
function sessionIdOf(exec) {
  return exec?.agent?.id;
}

function present(title, kind, rawInput) {
  return {
    card: "generic",
    title,
    kind,
    ...(rawInput === undefined ? {} : { rawInput }),
  };
}

/** Human-readable error text for logs. */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Recompute one session's profile section text. */
async function refreshSection(ctx, sessionId, section) {
  // Degrade independently: a fresh session has no OpenViking session yet
  // (created at the first flush), so profile() 404s on turn one — that must
  // not drag the whole refresh down. Recall alone still yields a useful
  // block. Failures are logged (not swallowed silently) for post-mortems.
  const warn = (what, error) =>
    ctx.logger?.warn?.(`tool-memory: ${what} fetch failed: ${errorText(error)}`);
  const [profileResult, recallResult] = await Promise.all([
    ctx.memory
      .profile(sessionId, { maxTokens: section.maxTokens, cacheTtlMs: section.cacheTtlMs })
      .catch((error) => {
        warn("profile", error);
        return { overview: "" };
      }),
    ctx.memory
      .recall(section.query, { maxTokens: section.maxTokens, sessionId })
      .catch((error) => {
        warn("recall", error);
        return { entries: [] };
      }),
  ]);
  return composeSection(
    { overview: profileResult?.overview ?? "", entries: recallResult?.entries ?? [] },
    section,
  );
}

/** Plain text of model-facing content blocks. */
export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      if (out.length > 0) out += "\n";
      out += block.text;
    }
  }
  return out;
}

/** Concatenated text of the direct human messages entering this step. */
export function userInputText(messages) {
  const parts = [];
  for (const message of messages ?? []) {
    if (message?.source?.kind !== "user") continue;
    const text = textOf(message.content);
    if (text.length > 0) parts.push(text);
  }
  return parts.join("\n");
}

/** Project name from a session cwd, or '' when unknown. */
export function projectOf(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return "";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Render the injected memory-context block (catalog framing, like skills). */
export function renderMemoryContext(entries, dynamic) {
  const lines = entries.map((entry) => {
    // Sanitize: stored text must never be able to close our block early.
    const text = sanitizeText(String(entry.text ?? "")).split("\n")[0].slice(0, 160);
    return `- [${entry.category}] ${text} (${entry.uri})`;
  });
  return [
    "<memory_context>",
    "The following memories are relevant to the user's current input. They are",
    "clues only — for full content call memory_recall or memory_search with the",
    "given URIs; do not infer facts beyond these summaries.",
    ...lines,
    "</memory_context>",
  ].join("\n");
}

/**
 * Per-input targeted injection. Called from the `agent/pre-step` waterfall:
 * retrieves memories for the direct user input (semantic + project tags) and
 * injects one `memory-context` user message. Each new turn replaces the
 * previous turn's message in the durable surface, so history keeps exactly
 * one injection regardless of turn count.
 *
 * Cost control: trivial inputs below `dynamic.minInputChars` are skipped, and
 * an input identical to the previous turn reuses the cached entries without a
 * second search round-trip.
 * @param {object} ctx - plugin context.
 * @param {object} payload - pre-step payload ({ agent, turn, step, signal }).
 * @param {object} decision - the pre-step decision from `next()`.
 * @param {object} dynamic - resolved dynamic config.
 * @param {Map<string, {turn: number, seq: number, inputKey?: string, lastEntries?: Array<object>}>} injected
 *   - per-session state.
 * @returns {Promise<object>} the (possibly) amended decision.
 */
export async function injectDynamic(ctx, payload, decision, dynamic, injected) {
  if (decision.kind !== "enter") return decision;
  const agent = payload.agent;
  if (agent === undefined) return decision;
  const state = injected.get(agent.id);
  if (state !== undefined && state.turn === payload.turn) return decision;

  const input = userInputText(decision.messages).slice(0, dynamic.inputMaxChars);
  if (input.length === 0 || input.length < (dynamic.minInputChars ?? 0)) return decision;

  const inputKey = `${input.length}:${input.slice(0, 24)}:${input.slice(-24)}`;
  let entries;
  if (state !== undefined && state.inputKey === inputKey && (state.lastEntries?.length ?? 0) > 0) {
    // Identical consecutive input (repeat commands, retries): reuse the
    // previous snapshot instead of paying another synchronous search.
    entries = state.lastEntries;
  } else {
    const project = projectOf(agent.session?.header?.cwd);
    const projectTag = project === "" ? undefined : `${dynamic.projectTagPrefix}${project}`;
    let result = await ctx.memory
      .search(input, {
        maxTokens: dynamic.maxTokens,
        scoreThreshold: dynamic.minScore,
        ...(projectTag === undefined ? {} : { tags: [projectTag] }),
      })
      .catch(() => ({ entries: [] }));
    // Tag-targeted first, then degrade to plain semantic search when the
    // project tag matches nothing.
    if ((result?.entries ?? []).length === 0 && projectTag !== undefined) {
      result = await ctx.memory
        .search(input, { maxTokens: dynamic.maxTokens, scoreThreshold: dynamic.minScore })
        .catch(() => ({ entries: [] }));
    }
    entries = (result?.entries ?? [])
      .filter((entry) => MEMORY_CATEGORIES.has(entry.category))
      // Under tight token budgets OpenViking downgrades entries to the uri
      // tier (no text) — those carry no usable clue, drop them.
      .filter((entry) => sanitizeText(entry.text).length > 0)
      .slice(0, dynamic.maxEntries);
  }
  if (entries.length === 0) return decision;

  const message = createUserMessage({
    content: [{ type: "text", text: renderMemoryContext(entries, dynamic) }],
    source: { kind: "memory-context", form: "snapshot" },
  });
  const session = agent.session;
  const surface = session.surface;
  let seq;
  if (state !== undefined && surface.nodes.includes(state.seq)) {
    const index = surface.nodes.indexOf(state.seq);
    const event = session.append("user/message", message, {
      surfaceOp: { op: "replace", start: index, end: index },
      sourceEventSeqs: [state.seq],
    });
    seq = event.seq;
  } else {
    const event = session.append("user/message", message, { surfaceOp: "append" });
    seq = event.seq;
  }
  injected.set(agent.id, { turn: payload.turn, seq, inputKey, lastEntries: entries });
  return decision;
}

const TEXT_OUTPUT = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: String(value) }],
};

const JSON_OUTPUT = {
  schema: { type: "object", additionalProperties: true },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 */
export function apply(ctx, config) {
  // `section` / `dynamic` are mutable bindings: the optional settings wiring
  // below (WebUI 设置 → 插件配置 card) swaps them whenever the resolved
  // settings layer changes, so every closure created after this point reads
  // the live configuration.
  let section = config.section;
  let dynamic = config.dynamic ?? {};
  let skipFirstTurnSet = new Set(config.firstTurn?.skipPresets ?? []);
  let skipAllFirstTurn = config.firstTurn?.skipAllFirstTurn === true;
  const firstTurnSuppressed = new Set(); // session ids suppressed on turn 1
  let resolveSettings = null;
  const settingsSvc = ctx.get("settings");
  if (settingsSvc !== undefined) {
    try {
      installSettingsSection(ctx, NS, Config, config, {
        setSource: (thunk) => {
          resolveSettings = thunk;
        },
        onChange: () => {
          try {
            const resolved = typeof resolveSettings === "function" ? resolveSettings() : null;
            if (resolved === null || typeof resolved !== "object") return;
            if (resolved.section !== undefined && typeof resolved.section === "object") {
              section = resolved.section;
            }
            if (resolved.dynamic !== undefined && typeof resolved.dynamic === "object") {
              dynamic = resolved.dynamic;
            }
            if (resolved.firstTurn !== undefined && typeof resolved.firstTurn === "object") {
              const list = resolved.firstTurn.skipPresets;
              skipFirstTurnSet = new Set(Array.isArray(list) ? list : []);
              skipAllFirstTurn = resolved.firstTurn.skipAllFirstTurn === true;
            }
          } catch (error) {
            console.error("tool-memory: settings apply failed: " + (error && error.message));
          }
        },
      });
    } catch (error) {
      console.error("tool-memory: settings namespace install failed: " + (error && error.message));
    }
  }
  const cache = new ProfileCache(section);
  const refresh = (sessionId) => refreshSection(ctx, sessionId, section);
  /** sessionId -> { turn, seq, inputKey, lastEntries } (per-turn injection). */
  const injected = new Map();

  if (section.enabled) {
    ctx.systemPrompt.section({
      name: "memory:profile",
      order: 95,
      text: (context) => {
        const agent = context.agent ?? context.scope;
        const sessionId = agent?.id;
        if (sessionId === undefined) return "";
        // First turn of a skip-preset: no profile block either.
        if (firstTurnSuppressed.has(sessionId)) return "";
        return cache.read(sessionId, refresh);
      },
    });
    // Warm the cache at session start.
    ctx.on("agent/session-start", ({ agent }) => {
      cache.refresh(agent.id, refresh).catch(() => {});
    });
  }

  if (dynamic.enabled) {
    // Per-input targeted injection: one memory-context message per turn,
    // replacing the previous turn's (surface replace, never accumulating).
    // Presets listed in `firstTurn.skipPresets` (or every preset when
    // `skipAllFirstTurn`) get NO injection on turn 1 (pristine first prompt);
    // the suppression tag is cleared from turn 2.
    ctx.on("agent/pre-step", async (payload, next) => {
      const decision = await next();
      try {
        const agent = payload.agent;
        if (agent !== undefined) {
          const preset = agent.session?.header?.agentPreset;
          const first = payload.turn <= 1;
          if (
            first &&
            (skipAllFirstTurn || (preset !== undefined && skipFirstTurnSet.has(preset)))
          ) {
            firstTurnSuppressed.add(agent.id);
            return decision;
          }
          if (payload.turn > 1) firstTurnSuppressed.delete(agent.id);
        }
        return await injectDynamic(ctx, payload, decision, dynamic, injected);
      } catch (error) {
        ctx.logger?.warn?.(`tool-memory: dynamic injection failed: ${errorText(error)}`);
        return decision;
      }
    });
  }

  // Cache cascade (S4): the host memory service emits this after every
  // successful commit, so the profile cache never serves a stale overview
  // for up to `cacheTtlMs` past a commit.
  ctx.on("memory-openviking/session-committed", ({ sessionId }) => {
    cache.clear(sessionId);
  });
  // Reclaim per-agent bookkeeping at disposal (no unbounded Map growth).
  ctx.on("agent/disposed", ({ agent }) => {
    cache.clear(agent?.id);
    injected.delete(agent?.id);
    firstTurnSuppressed.delete(agent?.id);
  });

  ctx.systemPrompt.section({ name: "tool:memory", order: 113, text: GUIDANCE });

  ctx.tools.register(
    defineTool({
      name: "memory_write",
      description:
        "Explicitly store a fact, preference, or decision into long-term memory so future sessions can recall it. Use for durable user-owned information, not for transient task state.",
      parameters: {
        memory: {
          type: "string",
          required: true,
          description: "The fact or preference to remember, written as a clear statement.",
        },
      },
      output: JSON_OUTPUT,
      execute(args, exec) {
        const sessionId = sessionIdOf(exec);
        if (sessionId === undefined) throw new Error("memory_write requires a calling agent");
        return ctx.memory.write(sessionId, [{ role: "user", content: args.memory }]);
      },
      presentCall: (args) => present("Write memory", "other", args.memory),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_recall",
      description:
        "Recall a flat, assembled memory block relevant to the query (preferences, entities, events with scores and source URIs). Use when the session profile does not cover the question.",
      parameters: {
        query: { type: "string", required: true, description: "What to recall." },
        max_chars: {
          type: "number",
          description: "Approximate size cap for the returned block (default 1200).",
        },
      },
      output: TEXT_OUTPUT,
      execute(args, exec) {
        const maxTokens = args.max_chars
          ? Math.max(64, Math.ceil(args.max_chars / 4))
          : section.maxTokens;
        return ctx.memory.recall(args.query, {
          maxTokens,
          sessionId: sessionIdOf(exec),
        }).then((result) => result.rendered ?? "");
      },
      presentCall: (args) => present("Recall memory", "other", args.query),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_search",
      description:
        "Structured memory search: returns entries with category, score, detail level, text, and viking:// URIs for citation.",
      parameters: {
        query: { type: "string", required: true, description: "What to search for." },
        limit: { type: "number", description: "Maximum number of entries (default 10)." },
      },
      output: JSON_OUTPUT,
      execute(args, exec) {
        return ctx.memory.search(args.query, {
          maxTokens: section.maxTokens,
          sessionId: sessionIdOf(exec),
        }).then((result) => ({
          entries: (result.entries ?? []).slice(0, args.limit ?? 10),
          stats: result.stats ?? {},
        }));
      },
      presentCall: (args) => present("Search memory", "other", args.query),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_profile",
      description:
        "Show the current injected user-profile section (session working memory plus recalled preferences/entities/events) for this session.",
      parameters: {},
      output: TEXT_OUTPUT,
      execute(_args, exec) {
        const sessionId = sessionIdOf(exec);
        if (sessionId === undefined) throw new Error("memory_profile requires a calling agent");
        return cache.refresh(sessionId, refresh);
      },
      presentCall: () => present("Show memory profile", "read"),
    }),
  );

  ctx.tools.register(
    defineTool({
      name: "memory_forget",
      description:
        "Remove a stored memory by its viking:// URI. The URI must live under a memories/ namespace; deletion is single-item unless recursive=true, and every call is audit-logged by the host service. Use only when the user explicitly asks to forget something.",
      parameters: {
        uri: {
          type: "string",
          required: true,
          description: "The viking:// URI to remove (must be under a memories/ namespace).",
        },
        recursive: {
          type: "boolean",
          description: "Also delete everything below the URI. Defaults to false.",
        },
      },
      output: JSON_OUTPUT,
      execute(args) {
        return ctx.memory
          .forget(args.uri, { recursive: args.recursive === true })
          .then(() => ({ removed: args.uri, recursive: args.recursive === true }));
      },
      presentCall: (args) => present("Forget memory", "other", args.uri),
    }),
  );
}
