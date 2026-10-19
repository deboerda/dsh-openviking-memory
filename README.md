# dsh-openviking-memory — Local Long-Term Memory Stack for DSH

> Turn **DeepSeek Harness (DSH) Desktop** into an agent that **remembers across sessions**: capture → distill → embed → recall. This kit wires OpenViking server config, local embeddings, DSH plugins, and a portable deploy layer so another machine can be online in ~15 minutes.

[![PowerShell](https://img.shields.io/badge/Deploy-PowerShell-5391FE?logo=powershell)](#)
[![OpenViking](https://img.shields.io/badge/Memory-OpenViking-green)](#)
[![Embedding](https://img.shields.io/badge/Embedding-llama.cpp%20bge--m3-orange)](#)

## What it does for AI agent memory

| Stage | Behavior |
|-------|----------|
| **Capture** | DSH host plugin records session turns |
| **Distill** | OpenViking calls any OpenAI-compatible VLM to extract preferences / entities / events |
| **Embed** | Local `llama.cpp` + **bge-m3** (CPU, Chinese-friendly, 1024-d) — no GPU required |
| **Recall** | Next session injects `<memory_profile>`; tools: `memory_recall / write / search / profile / forget` |

Result: agents keep durable project context without stuffing the entire chat history into every prompt.

## Architecture

```
DSH Desktop (web / unity / desktop profiles)
  ├─ dsh-memory-openviking   → capture + distill trigger
  └─ dsh-tool-memory         → memory_* tools + profile inject
           │  HTTP + X-API-Key
           ▼
OpenViking :1933
  · store: viking://user/<user>/…
  · VLM distill: configurable OpenAI-compatible endpoint
  · embedding: localhost llama-server :8089 (bge-m3 GGUF)
```

## Repo contents

| Path | Role |
|------|------|
| `deploy/` | **One-click portability** — start/stop, shortcuts, templates, runbook |
| `scripts/start_openviking.ps1` | Idempotent start + health checks (`-Silent`) |
| `scripts/stop_openviking.ps1` | Clean shutdown |
| `config/*.yml` / `ov.conf.example` | Cordis patches + server template (placeholders only) |
| `vendor/dsh-memory-openviking/` | Upstream plugin sources (MIT) |

## Quick deploy

Follow **[deploy/README.md](deploy/README.md)** on a new Windows box. Minimal path:

1. Dedicated venv + `openviking` (keep MCP versions isolated — FastMCP 1.x vs 2.x clash)
2. Download bge-m3 GGUF · fill `ov.conf` placeholders · `start_openviking.ps1`
3. Create account → copy **user key** into cordis patches · restart DSH
4. Optional: `deploy\make-shortcuts.ps1` for desktop start/stop icons

## Design choices worth hiring for

- **Local-first embeddings** — privacy + zero embedding API cost
- **Pluggable distill endpoint** — any OpenAI-compatible VLM; keys stay out of git
- **Failure isolation** — plugins retry if memory server starts later; job-object-safe shortcut launch documented
- **Multi-profile memory sharing** — web/unity profiles can share one account/user or isolate on purpose

## Upstream

- [zouyuanqing/dsh-memory-openviking](https://github.com/zouyuanqing/dsh-memory-openviking) (MIT)
- [volcengine/OpenViking](https://github.com/volcengine/OpenViking) (AGPLv3)
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

## Role

Integration & packaging of a **production-usable local memory stack** for desktop AI agents (DSH) — ops scripts, config, and deploy UX, not just a README dump of upstream docs.

---

*v0.5.1+ · Clear employer story: “local long-term memory for my coding agent.” 为 DSH 落地的本地长期记忆套件。*
