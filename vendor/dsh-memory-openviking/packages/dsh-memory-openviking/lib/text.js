/**
 * Plain-text extraction from model-facing content blocks.
 * @module @deepseek-ai/dsh-memory-openviking/text
 */

/**
 * Flatten a message's content blocks to plain text. Tool-call and
 * tool-result blocks carry no free text of their own here (their bodies are
 * excluded from long-term capture by default).
 * @param content - model-facing content blocks.
 * @returns joined plain text, or '' when nothing textual is present.
 */
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

/**
 * OpenViking session id derived from a DSH session id. Stable across
 * restarts so committed archives keep accumulating on the same session.
 * @param dshSessionId - DSH session id (from `session.id`).
 * @returns the OpenViking session id.
 */
export function vikingSessionId(dshSessionId) {
  return `dsh-${dshSessionId}`;
}
