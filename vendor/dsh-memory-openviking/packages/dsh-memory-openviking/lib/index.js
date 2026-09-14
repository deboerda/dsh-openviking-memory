/**
 * `@deepseek-ai/dsh-memory-openviking` — host-plane memory service.
 *
 * Row (host composition, e.g. `$DSH_HOME/cordis.patch.yml`):
 * ```yaml
 * - id: memory-openviking
 *   name: '@deepseek-ai/dsh-memory-openviking'
 *   config:
 *     baseUrl: 'http://127.0.0.1:18770'
 * ```
 *
 * The service provides `ctx.memory` (write/recall/search/profile/forget/
 * commit/health) and automatically captures session surface events into the
 * OpenViking server. Capture is write-behind with retain-on-failure retry
 * (exponential backoff), an optional on-disk dead-letter queue, and a final
 * commit at agent/session disposal so short sessions are never lost.
 *
 * Multi-tenant deployments: set `account`/`user`, `peerPerSession: true` and
 * `peerScope: 'actor'`. Without them every DSH session shares one actor.
 * @module @deepseek-ai/dsh-memory-openviking
 */

import z from "@deepseek-ai/schemastery";
import { installSettingsSection } from "@deepseek-ai/dsh-settings";
import { MemoryService } from "./service.js";

export const name = "memory-openviking";

export const inject = [];

/** Settings namespace carrying this plugin's runtime configuration. */
const NS = "memory-openviking";

/** Latest settings-resolution thunk installed by installSettingsSection. */
let sourceThunk = null;

/** Schemastery configuration for the memory service row. */
export const Config = z.object({
  baseUrl: z.string().default("http://127.0.0.1:18770"),
  apiKey: z.string(),
  account: z.string(),
  user: z.string(),
  /** Map every DSH session to its own OpenViking actor peer. Dev mode has no
   * peers (verified 0.4.13); this is the production multi-session switch. */
  peerPerSession: z.boolean().default(false),
  /** Recall peer scope: 'all' spans every peer, 'actor' stays on the actor.
   * Single-user dev default is 'all'; multi-user deployments must use
   * 'actor' together with peerPerSession + account/user. */
  peerScope: z.union([z.const("all"), z.const("actor")]).default("all"),
  capture: z
    .object({
      /** Capture tool-result messages too (noisy; off by default). */
      toolResults: z.boolean().default(false),
      /** Capture injected/non-human user-role messages (skill content,
       * notices, goal rounds) in addition to direct human prompts. The
       * per-turn `memory-context` injection is ALWAYS excluded regardless of
       * this flag (self-injection guard). */
      nonUserSources: z.boolean().default(false),
      /** Capture subagent sessions (delegationDepth > 0). */
      subagentSessions: z.boolean().default(false),
      /** Early drain when the buffered capture exceeds this many chars. */
      flushThresholdBytes: z.number().default(4096),
      /** Commit (memory extraction) after this many added messages. */
      commitIntervalMessages: z.number().default(16),
      /** Minimum interval between commits even when below the message
       * threshold (keeps the extraction queue from flooding on chatty
       * sessions that flush frequently). */
      commitIntervalMs: z.number().default(60000),
      /** Messages left un-archived at each commit; the final commit at
       * session disposal uses 0 so nothing is ever stranded. */
      keepRecentMessages: z.number().default(4),
      /** Hard cap on the retained buffer while the server is down; oldest
       * messages are shed (dead-lettered when `deadLetterDir` is set). */
      maxBufferBytes: z.number().default(262144),
      /** Upper bound on how long `session/flush` waits for the network; the
       * drain keeps running in the background past this window. 0 = wait. */
      flushTimeoutMs: z.number().default(2000),
      /** Consecutive failed drain attempts before dead-letter/drop. */
      retryMaxAttempts: z.number().default(8),
      /** Exponential backoff base (ms): delay = base * 2^(attempt-1). */
      retryBaseDelayMs: z.number().default(1000),
      /** Exponential backoff ceiling (ms). */
      retryMaxDelayMs: z.number().default(60000),
    })
    .default({}),
  recall: z
    .object({
      maxTokens: z.number().min(64).max(32000).default(1600),
      scoreThreshold: z.number(),
      /** Profile cache lifetime in ms. */
      cacheTtlMs: z.number().default(300000),
      purpose: z.union([z.const("chat"), z.const("coding")]),
    })
    .default({}),
  timeoutMs: z.number().default(15000),
  /** Directory for the on-disk dead-letter queue (JSONL per failed batch
   * after retries are exhausted). Empty string disables persistence and
   * falls back to warn-only drops. */
  deadLetterDir: z.string().default(""),
});

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config
 * @returns {MemoryService}
 */
export function apply(ctx, config) {
  const service = new MemoryService(ctx, config);
  // Optional settings wiring: registers the `memory-openviking` namespace
  // with the settings service so the WebUI 设置 → 插件配置 card (client
  // half, `dsh.client`) can edit every field. The resolved settings layer
  // (user section > row config > schema defaults) is applied to the live
  // service on every change; new sessions and freshly created clients pick
  // it up immediately, existing per-session clients on their next rebuild.
  const settingsSvc = ctx.get("settings");
  if (settingsSvc !== undefined) {
    try {
      installSettingsSection(ctx, NS, Config, config, {
        setSource: (thunk) => {
          sourceThunk = thunk;
        },
        onChange: () => {
          try {
            const resolved = typeof sourceThunk === "function" ? sourceThunk() : null;
            if (resolved === null || typeof resolved !== "object") return;
            Object.assign(config, resolved);
            Object.assign(service.config, resolved);
            if (resolved.capture !== undefined && typeof resolved.capture === "object") {
              Object.assign(service.capture, resolved.capture);
            }
            if (resolved.recall !== undefined && typeof resolved.recall === "object") {
              Object.assign(service.recallConfig, resolved.recall);
            }
          } catch (error) {
            console.error("memory-openviking: settings apply failed: " + (error && error.message));
          }
        },
      });
    } catch (error) {
      console.error("memory-openviking: settings namespace install failed: " + (error && error.message));
    }
  }
  return service;
}
