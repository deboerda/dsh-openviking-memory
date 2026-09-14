/**
 * Profile-section composition and per-session caching for the memory prompt
 * injection. Pure logic, unit-testable without a live `memory` service.
 * @module @deepseek-ai/dsh-tool-memory/profile
 */

/** Memory categories worth injecting as user profile. */
export const MEMORY_CATEGORIES = new Set(["preferences", "entities", "events", "experiences"]);

/** Block tags that memory content must never smuggle into our prompts. */
const INJECTION_TAGS =
  /<\/?(memory_profile|memory_context|recalled_memories|session_working_memory)\b[^>]*>/gi;

/**
 * Neutralize block-breaking markup in memory text before injection. Memory
 * content is model-written and cross-session, so it is prompt-injection
 * surface: a stored `</memory_profile>` must never terminate our block.
 * @param {unknown} text
 * @returns {string} sanitized text.
 */
export function sanitizeText(text) {
  return String(text ?? "").replace(INJECTION_TAGS, "").trim();
}

/**
 * Truncate to `max` chars at a word boundary without splitting a surrogate
 * pair (UTF-16-safe).
 */
function truncateTail(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  const boundary = cut.search(/\s+\S*$/);
  if (boundary >= 0) cut = cut.slice(0, boundary);
  return cut;
}

/**
 * Compose the `<memory_profile>` section text from a session working-memory
 * overview and a context-recall entry list.
 *
 * Length policy: when the budget is exceeded the content is shrunk at word
 * boundaries with explicit priority — recalled memories first, then the
 * overview (overviews are NOT exempt from the budget). Shrinking happens
 * inside the sub-blocks, so the closing `</memory_profile>` tag and every
 * sub-block closer always survive intact.
 * @param {object} parts
 * @param {string} parts.overview - session working-memory overview ('' when absent).
 * @param {Array<object>} parts.entries - context-search entries.
 * @param {object} config - resolved section configuration.
 * @returns {string} the section text ('' when nothing qualifies).
 */
export function composeSection({ overview, entries }, config) {
  const hasOverview = config.includeSessionOverview && overview.length > 0;
  let overviewText = sanitizeText(overview);
  let recalledText = (entries ?? [])
    .filter((entry) => MEMORY_CATEGORIES.has(entry.category) && (entry.score ?? 0) >= config.minScore)
    .map((entry) => ({ category: entry.category, text: sanitizeText(entry.text) }))
    .filter((entry) => entry.text.length > 0)
    .map((entry) => `- [${entry.category}] ${entry.text}`)
    .join("\n");
  if (!hasOverview && recalledText.length === 0) return "";

  const header = "<memory_profile>\n";
  const footer = "\n</memory_profile>";
  const budget = config.maxChars;
  const render = (o, r) => {
    const blocks = [];
    if (hasOverview && o.length > 0) {
      blocks.push(`<session_working_memory>\n${o}\n</session_working_memory>`);
    }
    if (r.length > 0) blocks.push(`<recalled_memories>\n${r}\n</recalled_memories>`);
    return header + blocks.join("\n\n") + footer;
  };

  let text = render(overviewText, recalledText);
  if (text.length <= budget) return text;
  // 1. Shrink the recalled list (lowest priority) until it fits or vanishes.
  while (recalledText.length > 0 && render(overviewText, recalledText).length > budget) {
    const shrink = Math.max(1, Math.floor(recalledText.length * 0.6));
    const next = truncateTail(recalledText, shrink);
    if (next.length === recalledText.length) break; // single unbreakable word
    recalledText = next;
  }
  if (render(overviewText, recalledText).length > budget) recalledText = "";
  // 2. Shrink the overview content the same way.
  text = render(overviewText, recalledText);
  if (text.length <= budget) return text;
  while (overviewText.length > 0 && render(overviewText, recalledText).length > budget) {
    const shrink = Math.max(1, Math.floor(overviewText.length * 0.6));
    const next = truncateTail(overviewText, shrink);
    if (next.length === overviewText.length) break;
    overviewText = next;
  }
  if (render(overviewText, recalledText).length > budget) return "";
  return render(overviewText, recalledText);
}

/**
 * Per-session section cache with TTL and single-flight refresh.
 */
export class ProfileCache {
  /**
   * @param {object} config - resolved section configuration.
   */
  constructor(config) {
    this.config = config;
    /** @type {Map<string, {text: string, at: number}>} */
    this.entries = new Map();
    /** @type {Set<string>} sessions with an in-flight refresh. */
    this.inflight = new Set();
  }

  /**
   * Read the cached section for one session; kick a background refresh when
   * the entry is stale. Synchronous — safe inside prompt assembly.
   * @param {string} sessionId
   * @param {(sessionId: string) => Promise<string>} refresh - recompute callback.
   * @returns {string} the cached (possibly stale) section text.
   */
  read(sessionId, refresh) {
    const entry = this.entries.get(sessionId);
    const now = Date.now();
    if (entry !== undefined && now - entry.at < this.config.cacheTtlMs) return entry.text;
    if (this.inflight.has(sessionId)) return entry?.text ?? "";
    this.inflight.add(sessionId);
    refresh(sessionId)
      .then((text) => {
        this.entries.set(sessionId, { text, at: Date.now() });
      })
      .catch(() => {
        // Keep the stale entry (or nothing) on failure; never break assembly.
        // Errors are surfaced by refreshSection's own logger in index.js.
      })
      .finally(() => {
        this.inflight.delete(sessionId);
      });
    return entry?.text ?? "";
  }

  /** Force an immediate refresh (used by tools and session start). */
  async refresh(sessionId, refresh) {
    const text = await refresh(sessionId);
    this.entries.set(sessionId, { text, at: Date.now() });
    return text;
  }

  /** Drop one session's entry (agent disposal / commit cascade). */
  clear(sessionId) {
    if (typeof sessionId === "string") this.entries.delete(sessionId);
  }
}
