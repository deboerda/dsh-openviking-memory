/**
 * Thin client facade over `@openviking/sdk` plus the context-mode recall
 * endpoint the SDK does not expose. All network access to OpenViking flows
 * through this module so the volatile 0.1.0 SDK surface stays contained.
 *
 * 0.4.x compatibility (patched for OpenViking 0.4.6, verified live):
 * - `POST /api/v1/search/search` on 0.4.6 accepts only the SearchRequest
 *   fields (query/session_id/score_threshold/tags/limit/...) — the 0.4.13
 *   `mode:"context"` / `max_tokens` / `purpose` / `peer_scope` / `detail` /
 *   `quotas` fields are rejected with 400 (`extra_forbidden`), so they are
 *   not sent.
 * - The 0.4.6 response returns `result.memories[]` with `abstract` +
 *   `context_type` instead of `result.entries[]` with `text` + `category`;
 *   the response is normalized here to the entries/rendered/stats shape the
 *   rest of the stack consumes. Category is derived from the memory URI
 *   (`viking://…/memories/<category>/…`) with `context_type` as fallback.
 * @module @deepseek-ai/dsh-memory-openviking/client
 */

import { OpenVikingClient } from "@openviking/sdk";
import { vikingSessionId } from "./text.js";

/**
 * One OpenViking client bound to an optional actor peer.
 * @typedef {object} MemoryClient
 * @property {OpenVikingClient} sdk - the underlying SDK client.
 * @property {(query: string, opts: object) => Promise<object>} recallContext
 *   semantic recall (`POST /api/v1/search/search`, normalized to
 *   entries/rendered/stats).
 * @property {(sessionId: string) => Promise<object>} ensureSession
 *   create-or-reuse one OpenViking session for a DSH session id.
 * @property {(sessionId: string, messages: Array<{role: string, content: string}>) => Promise<object>} addMessages
 *   ensure the session, then append messages to it.
 * @property {(sessionId: string, keepRecentMessages: number) => Promise<object>} commitSession
 *   ensure the session, then commit it (triggers server-side memory extraction).
 * @property {(uri: string, opts: {recursive: boolean}) => Promise<object>} forget
 *   remove a viking:// URI.
 * @property {() => Promise<boolean>} health
 *   server health check.
 */

/**
 * Build the client facade.
 * @param {object} config - resolved service configuration. `config.fetch`
 *   (internal, used by tests) overrides the global fetch.
 * @returns {MemoryClient}
 */
export function createMemoryClient(config) {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const sdk = new OpenVikingClient({
    baseUrl: config.baseUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.account ? { account: config.account } : {}),
    ...(config.user ? { user: config.user } : {}),
    ...(config.actorPeerId ? { actorPeerId: config.actorPeerId } : {}),
    ...(config.timeoutMs ? { timeout: config.timeoutMs } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });

  async function rawSearch(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 15000);
    try {
      const headers = { "Content-Type": "application/json" };
      if (config.apiKey) headers["X-API-Key"] = config.apiKey;
      if (config.account) headers["X-OpenViking-Account"] = config.account;
      if (config.user) headers["X-OpenViking-User"] = config.user;
      const res = await fetchImpl(`${config.baseUrl}/api/v1/search/search`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json();
      if (json.status !== "ok") {
        throw new Error(json.error?.message ?? `OpenViking search failed (${res.status})`);
      }
      return json.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Derive the memory category from the viking:// URI (0.4.6 memories carry
   *  no category field; the category lives in the URI path), falling back to
   *  `context_type` and finally 'memory'. */
  function categoryOf(uri, contextType) {
    const m = /\/memories\/([^/]+)\//.exec(uri ?? "");
    if (m) return m[1];
    if (typeof contextType === "string" && contextType.length > 0) return contextType;
    return "memory";
  }

  /** Normalize a 0.4.6 search result to the entries/rendered/stats shape the
   *  rest of the stack consumes. Tolerant of the 0.4.13 entries shape. */
  function normalizeRecall(result) {
    const memories = Array.isArray(result.memories) ? result.memories : [];
    const legacy = Array.isArray(result.entries) ? result.entries : [];
    const entries = [
      ...memories.map((m) => ({
        uri: m.uri,
        text: String(m.abstract ?? m.text ?? ""),
        score: typeof m.score === "number" ? m.score : 0,
        category: categoryOf(m.uri, m.context_type),
        ...(m.level !== undefined ? { level: m.level } : {}),
        ...(m.match_reason ? { match_reason: m.match_reason } : {}),
      })),
      ...legacy.map((m) => ({
        category: "memory",
        score: 0,
        ...m,
        text: String(m.text ?? m.abstract ?? ""),
      })),
    ];
    const lines = entries
      .filter((e) => e.text && e.text.length > 0)
      .map((e) => `[${e.category}] ${e.text} (${e.uri})`);
    return {
      entries,
      total: result.total ?? entries.length,
      rendered: lines.join("\n"),
      stats: { ...(result.stats ?? {}), total: result.total ?? entries.length },
    };
  }

  /** Create-or-reuse the OpenViking session backing one DSH session. */
  function ensureSession(dshSessionId) {
    return sdk.getSession(vikingSessionId(dshSessionId), true);
  }

  return {
    sdk,
    recallContext(query, opts = {}) {
      return rawSearch({
        query,
        // 0.4.6 SearchRequest fields only (see header note).
        ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
        ...(opts.scoreThreshold !== undefined ? { score_threshold: opts.scoreThreshold } : {}),
        ...(opts.tags ? { tags: opts.tags } : {}),
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      }).then(normalizeRecall);
    },
    ensureSession,
    async addMessages(dshSessionId, messages) {
      await ensureSession(dshSessionId);
      return sdk.batchAddMessages(vikingSessionId(dshSessionId), messages);
    },
    async commitSession(dshSessionId, keepRecentMessages) {
      await ensureSession(dshSessionId);
      return sdk.commitSession(vikingSessionId(dshSessionId), keepRecentMessages);
    },
    sessionContext(dshSessionId, tokenBudget) {
      return sdk.getSessionContext(vikingSessionId(dshSessionId), tokenBudget);
    },
    forget(uri, { recursive = false } = {}) {
      return sdk.remove(uri, { recursive });
    },
    health() {
      return sdk.health();
    },
  };
}
