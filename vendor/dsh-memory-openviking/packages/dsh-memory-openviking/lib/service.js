/**
 * The host-plane `memory` service: automatic long-term memory capture from
 * DSH session events into a local OpenViking server, plus recall/profile
 * primitives for tools and prompt assembly.
 *
 * Capture model (mirrors `dsh-session`'s persistence contract):
 * - `session/event` (write-behind): surface messages are buffered per session.
 * - `session/flush` (bounded await): the buffer is drained with one
 *   `batchAddMessages` call; the listener never holds the durability
 *   checkpoint for longer than `capture.flushTimeoutMs`.
 * - Byte threshold triggers an early drain between flushes.
 * - Drains are serialized per session (single in-flight HTTP call), and a
 *   failed drain RETAINS the buffered messages, retrying with exponential
 *   backoff. After `capture.retryMaxAttempts` failures the messages are
 *   dead-lettered to `deadLetterDir/deadletter.jsonl` (when configured) or
 *   dropped with a warn — never silently before retries are exhausted.
 * - `agent/disposed` / `session/disposed` fire a final commit with
 *   `keepRecentMessages: 0` so short sessions and their trailing messages
 *   still get archived and extracted.
 *
 * Every OpenViking call is failure-isolated: a dead server degrades capture
 * but never blocks the session loop.
 * @module @deepseek-ai/dsh-memory-openviking/service
 */

import { Service } from "@deepseek-ai/cordis";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createMemoryClient } from "./client.js";
import { textOf } from "./text.js";

/** Hard defaults for capture fields (tests bypass schemastery). */
const CAPTURE_DEFAULTS = {
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
};

const RECALL_DEFAULTS = { maxTokens: 1600, cacheTtlMs: 300000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-session runtime state.
 * @typedef {object} SessionState
 * @property {import('./client.js').MemoryClient} client
 * @property {{messages: Array<{role: string, content: string}>, seqs: Set<number>, bytes: number}} buffer
 * @property {number} pendingCount - messages added to the server since the last commit.
 * @property {number} addedTotal - messages ever added (forces commit on dispose).
 * @property {number} attempts - consecutive failed drain attempts.
 * @property {boolean} retryPending - a backoff retry timer is scheduled.
 * @property {boolean} tailUncommitted - the last commit skipped the recent tail.
 * @property {boolean} finalizing - a final commit was requested (keepRecent 0).
 * @property {Promise<void>} chain - serialized drain queue for this session.
 * @property {number} [lastCommitAt]
 * @property {boolean} capture - whether this session's events are captured.
 * @property {{text: string, at: number} | undefined} profileCache
 * @property {boolean} warned - whether a capture failure was already logged.
 */

/** The host-plane memory service. */
export class MemoryService extends Service {
  /**
   * @param {import('@deepseek-ai/cordis').Context} ctx
   * @param {object} config - resolved configuration.
   */
  constructor(ctx, config) {
    super(ctx, "memory");
    this.config = config;
    this.capture = { ...CAPTURE_DEFAULTS, ...(config.capture ?? {}) };
    /** Resolved recall configuration (named to not shadow the recall method). */
    this.recallConfig = { ...RECALL_DEFAULTS, ...(config.recall ?? {}) };
    this.logger = ctx.logger;
    /** @type {Map<string, SessionState>} keyed by DSH session id. */
    this.states = new Map();
    /** Lazy shared client for recall/search/forget/health (no actor peer). */
    this.sharedClient = undefined;

    ctx.on("session/created", (session) => {
      if (!this._captureWorthy(session.header)) return;
      this._ensureState(session.id, session.header);
    });
    ctx.on("session/event", (session, event) => {
      try {
        this._onEvent(session, event);
      } catch (error) {
        this.logger.warn(`memory: session/event handler failed: ${errorMessage(error)}`);
      }
    });
    ctx.on("session/flush", (session) => {
      return this._flush(session);
    });
    // Final-commit fallback: an agent that ends its turn is the deterministic
    // "session work is done" signal (fires before session detachment), and
    // session/disposed reclaims the per-session state afterwards.
    ctx.on("agent/disposed", (payload) => {
      const agent = payload?.agent;
      if (agent === undefined || typeof agent.id !== "string") return;
      this._finalize(agent.id);
    });
    ctx.on("session/disposed", (session) => {
      const id = typeof session === "string" ? session : session?.id;
      if (typeof id !== "string") return;
      this._dispose(id);
    });

    if (
      !config.peerPerSession &&
      config.peerScope === "all" &&
      !config.account &&
      !config.user
    ) {
      this.logger.warn(
        "memory-openviking: running in shared single-actor mode (peerPerSession=false, " +
          "peerScope='all', no account/user). Every DSH session shares one OpenViking actor, " +
          "so memories leak across users in multi-user deployments. Configure account/user and " +
          "peerPerSession=true with peerScope='actor' — see the README multi-tenant section.",
      );
    }
  }

  // ── internal: capture pipeline ───────────────────────────────────────────

  /** Whether events for a session with this header should be captured. */
  _captureWorthy(header) {
    const depth = header?.delegationDepth ?? 0;
    return depth === 0 || this.capture.subagentSessions;
  }

  /** Create (or return) the per-session state and client. */
  _ensureState(sessionId, header) {
    let state = this.states.get(sessionId);
    if (state !== undefined) return state;
    const capture = this._captureWorthy(header);
    state = {
      client: createMemoryClient({
        ...this.config,
        actorPeerId: this.config.peerPerSession ? `dsh-${sessionId}` : undefined,
      }),
      buffer: { messages: [], seqs: new Set(), bytes: 0 },
      pendingCount: 0,
      addedTotal: 0,
      attempts: 0,
      retryPending: false,
      tailUncommitted: false,
      finalizing: false,
      chain: Promise.resolve(),
      lastCommitAt: undefined,
      capture,
      profileCache: undefined,
      warned: false,
    };
    this.states.set(sessionId, state);
    return state;
  }

  /** The shared, non-peer client used by recall/search/forget/health. */
  _shared() {
    if (this.sharedClient === undefined) {
      this.sharedClient = createMemoryClient({ ...this.config, actorPeerId: undefined });
    }
    return this.sharedClient;
  }

  /** Buffer one surface event; early-drain past the byte threshold. */
  _onEvent(session, event) {
    // Capture-worthiness is judged from the EVENT's own header every time:
    // a state created earlier by a public API call (write/profile/commit) on
    // a subagent session must not re-open capture for a session the config
    // says to skip.
    if (!this._captureWorthy(session.header)) return;
    const state = this._ensureState(session.id, session.header);
    if (!state.capture) return;
    const picked = pickEvent(event, this.capture);
    if (picked === undefined) return;
    if (state.buffer.seqs.has(event.seq)) return;
    state.buffer.seqs.add(event.seq);
    state.buffer.messages.push(picked);
    state.buffer.bytes += picked.content.length;
    if (state.buffer.bytes >= this.capture.flushThresholdBytes) {
      // Early drains are drain-only: no interval-based commit (the flush or
      // the message threshold owns commit timing for quiet sessions).
      this._drain(session.id, state, { intervalDue: false }).catch((error) => {
        this._warnOnce(state, `early drain failed: ${errorMessage(error)}`);
      });
    } else if (state.buffer.bytes >= this.capture.maxBufferBytes) {
      // Server has been down long enough to fill the cap: shed the oldest
      // message (dead-lettered when a directory is configured).
      const oldest = state.buffer.messages.shift();
      if (oldest !== undefined) {
        state.buffer.bytes -= oldest.content.length;
        void this._deadLetter(state, [oldest]);
        this._warnOnce(
          state,
          `buffer cap ${this.capture.maxBufferBytes} reached while retrying; shedding oldest messages`,
        );
      }
    }
  }

  /** Bounded-await durability checkpoint: drain (commit only when due). */
  async _flush(session) {
    if (!this._captureWorthy(session.header)) return;
    const state = this.states.get(session.id);
    if (state === undefined || !state.capture || state.buffer.messages.length === 0) return;
    const drain = this._drain(session.id, state, {});
    drain.catch((error) => {
      this._warnOnce(state, `flush drain failed: ${errorMessage(error)}`);
    });
    // Never hold the caller's awaited parallel checkpoint for the full HTTP
    // timeout: give the network a short bounded window, then return. The
    // serialized drain + retry loop keep running in the background.
    const cap = this.capture.flushTimeoutMs;
    if (cap > 0) {
      await Promise.race([drain.then(() => {}, () => {}), sleep(cap)]);
    } else {
      await drain.then(() => {}, () => {});
    }
  }

  /** Serialize one drain run onto the session's chain; never overlaps. */
  _drain(sessionId, state, opts = {}) {
    const run = () => this._drainNow(sessionId, state, opts);
    const next = state.chain.then(run, run);
    state.chain = next.then(() => {}, () => {});
    return next;
  }

  /** One serialized drain attempt: retain-on-failure, commit when due. */
  async _drainNow(sessionId, state, opts) {
    const { commit = false, force = false, intervalDue = true } = opts;
    const buffered = state.buffer.messages;
    let added = 0;
    if (buffered.length > 0) {
      try {
        // The client ensures the OpenViking session exists first, so a
        // server restart can never orphan a batch on a missing session.
        await state.client.addMessages(sessionId, buffered);
        added = buffered.length;
        // Success only now clears the buffer: a failed request keeps every
        // message queued for the backoff retry (durability, not drop-once).
        state.buffer = { messages: [], seqs: new Set(), bytes: 0 };
        state.pendingCount += added;
        state.addedTotal += added;
        state.attempts = 0;
      } catch (error) {
        state.attempts += 1;
        this._warnOnce(
          state,
          `capture failed (attempt ${state.attempts}/${this.capture.retryMaxAttempts}): ${errorMessage(error)}`,
        );
        this._scheduleRetry(sessionId, state);
        throw error;
      }
    }
    const due =
      commit === true ||
      force === true ||
      (state.pendingCount > 0 &&
        (state.pendingCount >= this.capture.commitIntervalMessages ||
          (intervalDue &&
            Date.now() - (state.lastCommitAt ?? 0) >= this._intervalFor(state))));
    if (due && state.addedTotal > 0) {
      const keepRecent = opts.keepRecent ?? this.capture.keepRecentMessages;
      await this._commit(sessionId, state, keepRecent);
    }
    return { added };
  }

  /**
   * Effective commit interval for one session. Every server-side commit
   * re-extracts the WHOLE session archive, so on long-running sessions a
   * fixed 60s interval saturates the OpenViking extraction queue (observed
   * live: 50+ pending session_commit tasks from one session). The interval
   * therefore grows with session length — message-threshold commits
   * (`commitIntervalMessages`) still apply and the final dispose commit
   * still archives everything.
   */
  _intervalFor(state) {
    const { commitIntervalMs, commitIntervalMessages } = this.capture;
    const steps = Math.floor(state.addedTotal / Math.max(1, commitIntervalMessages * 8));
    return commitIntervalMs * (1 + steps);
  }

  /** One server-side commit (memory extraction), failure-isolated. */
  async _commit(sessionId, state, keepRecent) {
    try {
      await state.client.commitSession(sessionId, keepRecent);
      state.pendingCount = 0;
      state.lastCommitAt = Date.now();
      state.profileCache = undefined;
      state.tailUncommitted = keepRecent > 0;
      if (keepRecent === 0) state.finalizing = false;
      // Cascade invalidation for downstream caches (tool-memory's profile
      // cache) so they never serve a stale overview past a commit.
      this.ctx.emit?.("memory-openviking/session-committed", { sessionId });
    } catch (error) {
      this._warnOnce(state, `commit failed: ${errorMessage(error)}`);
    }
  }

  /** Schedule one exponential-backoff retry; dead-letter at the attempt cap. */
  _scheduleRetry(sessionId, state) {
    if (state.retryPending) return;
    if (state.attempts >= this.capture.retryMaxAttempts) {
      const doomed = state.buffer.messages;
      state.buffer = { messages: [], seqs: new Set(), bytes: 0 };
      state.warned = false; // allow one more warn for the dead-letter event
      void this._deadLetter(state, doomed);
      if (doomed.length > 0) {
        this.logger.warn(
          `memory: gave up after ${state.attempts} attempts; ${doomed.length} message(s) ` +
            (this.config.deadLetterDir
              ? `dead-lettered to ${join(this.config.deadLetterDir, "deadletter.jsonl")}`
              : "dropped (set deadLetterDir to persist them)"),
        );
      }
      return;
    }
    const delay = Math.min(
      this.capture.retryMaxDelayMs,
      this.capture.retryBaseDelayMs * 2 ** (state.attempts - 1),
    );
    state.retryPending = true;
    this.ctx.setTimeout(() => {
      state.retryPending = false;
      const opts = state.finalizing ? { commit: true, force: true, keepRecent: 0 } : {};
      this._drain(sessionId, state, opts).catch(() => {});
    }, delay);
  }

  /** Final commit for an agent whose session work just ended. */
  _finalize(sessionId) {
    const state = this.states.get(sessionId);
    if (state === undefined || !state.capture) return;
    const hasWork =
      state.buffer.messages.length > 0 ||
      state.pendingCount > 0 ||
      (state.addedTotal > 0 && state.tailUncommitted);
    if (!hasWork) return;
    state.finalizing = true;
    this._drain(sessionId, state, { commit: true, force: true, keepRecent: 0 }).catch((error) => {
      this._warnOnce(state, `final commit failed: ${errorMessage(error)}`);
    });
  }

  /** Reclaim per-session state once its drain chain has settled. */
  _dispose(sessionId) {
    const state = this.states.get(sessionId);
    if (state === undefined) return;
    this._finalize(sessionId);
    // Keep the state (and its retry timers) alive until the chain settles so
    // in-flight retries can still land, then drop it from the map.
    state.chain.then(() => {
      if (this.states.get(sessionId) === state) this.states.delete(sessionId);
    });
  }

  /** Append messages to the dead-letter file (best effort, never throws). */
  async _deadLetter(state, messages) {
    const dir = this.config.deadLetterDir;
    if (!dir || messages.length === 0) return;
    try {
      await mkdir(dir, { recursive: true });
      const lines = messages.map((message) =>
        JSON.stringify({
          at: new Date().toISOString(),
          role: message.role,
          content: message.content,
        }),
      );
      await appendFile(join(dir, "deadletter.jsonl"), `${lines.join("\n")}\n`, "utf8");
    } catch (error) {
      this.logger.warn(`memory: dead-letter write failed: ${errorMessage(error)}`);
    }
  }

  /** Log a capture failure once per session (resettable). */
  _warnOnce(state, message) {
    if (state.warned) return;
    state.warned = true;
    this.logger.warn(`memory: ${message} (further failures suppressed for this session)`);
  }

  // ── public service API ───────────────────────────────────────────────────

  /**
   * Explicitly write messages to a session's long-term memory.
   * @param {string} sessionId - DSH session id.
   * @param {Array<{role: 'user' | 'assistant', content: string}>} messages
   * @returns {Promise<object>} add result.
   */
  async write(sessionId, messages) {
    const state = this._ensureState(sessionId, undefined);
    const normalized = messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? ""),
    }));
    const result = await state.client.addMessages(sessionId, normalized);
    state.pendingCount += normalized.length;
    state.addedTotal += normalized.length;
    if (state.pendingCount >= this.capture.commitIntervalMessages) {
      await this._commit(sessionId, state, this.capture.keepRecentMessages);
    }
    return { added: normalized.length, ...result };
  }

  /**
   * Context-mode recall: an assembled flat `<memory>` block plus entries.
   * @param {string} query
   * @param {object} [opts]
   * @returns {Promise<{rendered: string, entries: Array<object>, stats: object}>}
   */
  recall(query, opts = {}) {
    return this._shared().recallContext(query, {
      maxTokens: opts.maxTokens ?? this.recallConfig.maxTokens,
      scoreThreshold: opts.scoreThreshold ?? this.recallConfig.scoreThreshold,
      peerScope: opts.peerScope ?? this.config.peerScope,
      purpose: opts.purpose ?? this.recallConfig.purpose,
      sessionId: opts.sessionId,
      detail: opts.detail,
      quotas: opts.quotas,
      tags: opts.tags,
    });
  }

  /**
   * Structured context search: entries only (for tools).
   * @param {string} query
   * @param {object} [opts]
   * @returns {Promise<{entries: Array<object>, stats: object}>}
   */
  async search(query, opts = {}) {
    const result = await this.recall(query, opts);
    return { entries: result.entries ?? [], stats: result.stats ?? {} };
  }

  /**
   * Cached per-session profile overview (LLM-assembled working memory).
   * @param {string} sessionId - DSH session id.
   * @param {object} [opts]
   * @returns {Promise<{overview: string, cached: boolean, at: number}>}
   */
  async profile(sessionId, opts = {}) {
    const state = this._ensureState(sessionId, undefined);
    const ttl = opts.cacheTtlMs ?? this.recallConfig.cacheTtlMs;
    const now = Date.now();
    if (state.profileCache !== undefined && now - state.profileCache.at < ttl) {
      return { overview: state.profileCache.text, cached: true, at: state.profileCache.at };
    }
    const result = await state.client.sessionContext(
      sessionId,
      opts.maxTokens ?? this.recallConfig.maxTokens,
    );
    const overview = String(result?.latest_archive_overview ?? "");
    state.profileCache = { text: overview, at: now };
    return { overview, cached: false, at: now };
  }

  /**
   * Forget one viking:// URI. Safety boundaries: the URI must live under a
   * `memories/` namespace segment, deletion is non-recursive by default, and
   * every call is audit-logged.
   * @param {string} uri
   * @param {object} [opts] - { recursive?: boolean }
   * @returns {Promise<object>}
   */
  forget(uri, opts = {}) {
    if (typeof uri !== "string" || !/^viking:\/\/[^/\s]+\/.*\/memories\//.test(uri)) {
      throw new Error(
        "memory: forget only accepts viking:// URIs under a memories/ namespace " +
          "(e.g. viking://user/default/memories/entities/x)",
      );
    }
    const recursive = opts.recursive === true;
    this.logger.warn(
      `memory: forgetting ${uri} (recursive=${recursive}) — audit trail for destructive deletes`,
    );
    return this._shared().forget(uri, { recursive });
  }

  /**
   * Force a drain + commit for one session. Unlike the automatic path this
   * commits even when nothing new is buffered (so `keepRecentMessages`
   * trailing messages get archived), as long as the session ever received
   * anything.
   */
  async commit(sessionId) {
    const state = this._ensureState(sessionId, undefined);
    const drained = await this._drain(sessionId, state, { commit: true, force: true });
    return { drained };
  }

  /** Server health probe. */
  health() {
    return this._shared().health();
  }
}

/**
 * Pick one capturable message from a session event, or undefined to skip.
 * @param {object} event - the SessionEvent.
 * @param {object} capture - capture configuration.
 * @returns {{role: string, content: string} | undefined}
 */
export function pickEvent(event, capture) {
  switch (event.type) {
    case "user/message": {
      const message = event.data;
      // Self-injection guard: the per-turn memory-context message is
      // generated from memories and must never be re-captured, even when
      // nonUserSources is enabled (otherwise memory feeds back into itself).
      if (message.source?.kind === "memory-context") return undefined;
      if (message.source?.kind !== "user" && !capture.nonUserSources) return undefined;
      const content = textOf(message.content);
      return content.length === 0 ? undefined : { role: "user", content };
    }
    case "assistant/message": {
      const content = textOf(event.data.message?.content);
      return content.length === 0 ? undefined : { role: "assistant", content };
    }
    case "tool/result": {
      if (!capture.toolResults) return undefined;
      const content = textOf(event.data.message?.content);
      return content.length === 0 ? undefined : { role: "user", content };
    }
    default:
      return undefined;
  }
}

/** Human-readable error chain, tolerant of unknown error shapes. */
export function errorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
