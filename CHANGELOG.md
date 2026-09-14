# Changelog

## v0.5.1 - 2026-09-14

- `deploy/ov.conf.example`、`deploy/vlm.external.example.json`：蒸馏端点与模型填入默认值
  （`https://copilot-dev.tongyuan.cc/api/openai/v1` / `glm-5.3-flash`），只留 `<ROOT_API_KEY>`、`<VLM_API_KEY>`、`<OPENVIKING_USER_KEY>`
  三个真·密钥占位符 —— 换机复制即可用。
- `README.md` / `deploy/README.md`：对应说明同步更新。

## v0.5.0 - 2026-09-14

换机部署层（`deploy/`）+ 真机实测修订。

### 新增

- **`deploy/`**：可移植的启停/切换/图标/快捷方式脚本。全部以 `$PSScriptRoot` 为基准目录
  （`-Root` 可覆盖），llama.cpp 和模型放在脚本旁边即可跑。
- **`deploy/make-shortcuts.ps1`**：一键在桌面创建「OpenViking记忆-启动 / -停止」快捷方式（自带图标）。
- **`deploy/ov.conf.example`** / **`deploy/vlm.external.example.json`**：实测配置模板
  （本地 bge-m3 1024 维 embedding + 外部 OpenAI 兼容蒸馏网关 + 记忆 v2）。
- **`deploy/README.md`**：15 分钟换机部署手册 + 踩坑表。
- **`config/cordis-patch.desktop.yml`**：DSH Desktop profile 的挂载片段（原来只有 web / unity）。

### 修订（均在真机验证）

- **embedding 不要加 `--pooling mean`**：bge-m3 的 GGUF 声明的是 CLS，强制 MEAN 会把
  相关/不相关相似度差从 0.475 压到 0.339。实测参数：`--ctx-size 8192 --batch-size 512 -t 4 -ngl 0`。
- **不与本地大模型抢 CPU**：起服务后把 llama-server 优先级设为 `BelowNormal`；embedding 走 `-ngl 0`
  不吃显存，常驻约 0.5 GB、空闲 CPU ≈ 0%。
- **蒸馏 VLM 默认走外部网关**：本地抽取器改为 `-WithLocalExtractor` 显式开启。本地抽取器常驻约
  5.3 GB、占 4 线程；换外部网关后单次会话蒸馏从 ~6 分钟降到 ~21 秒，本机 CPU 零开销。
- **`stop_openviking.ps1`**：检测到 DSH Desktop 仍在运行会先弹确认，避免会话后半段静默丢记忆。
- **健康检查**：`start_openviking.ps1` 启动后轮询 `/health`（最长 120 秒），就绪/失败各有弹窗（`-Silent` 关闭）。

### 已知坑（细节见 `deploy/README.md`）

| 现象 | 原因 |
|---|---|
| OpenViking 启动报 `Invalid cache config: ... line 1 column 1` | `ov.conf` 带了 UTF-8 **BOM**，必须无 BOM |
| `.ps1` 明明没写错却报语法错误 | 含中文的脚本存成了 UTF-8 **无** BOM，Windows PowerShell 5.1 按 ANSI 解码 |
| 服务起来一会儿就没了，日志 `Embedding circuit breaker is open` | 从 DSH 工具调用/前台 pwsh 里启动，进程树被 job object 回收 |
| 插件加载失败 `cannot resolve package "@deepseek-ai/dsh-memory-openviking"` | 插件包不在 profile 的 `node_modules`；且**不能**跑 `pnpm install` |
| 蒸馏模型返回空内容 | 思维链模型把 token 全用在 reasoning 上，需要 `reasoning_effort: "low"` |

## v0.4.0

初版：OpenViking 服务端配置、本地 embedding 方案、DSH 插件接入片段、启停脚本、vendor 插件源码。
