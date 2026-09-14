# DSH OpenViking Long-Term Memory Kit

DSH Desktop（DeepSeek Harness）长期记忆的完整落地套件：OpenViking 服务端配置、
本地 embedding 方案、DSH 插件接入片段、启停脚本。换机器/重装后按本仓库即可复现。

## 架构

```
DSH Desktop (web / unity profile)
  └─ @deepseek-ai/dsh-memory-openviking   (host: 会话捕获 + 蒸馏触发)
  └─ @deepseek-ai/dsh-tool-memory         (memory_* 工具 + <memory_profile> 注入)
        │  HTTP Bearer X-API-Key (account/user 租户 key)
┌───────▼───────────────────────────────┐
│ OpenViking server  (127.0.0.1:1933)    │  蒸馏 VLM = 任意 OpenAI 兼容端点
│  记忆库: viking://user/<user>/...       │  embedding = 本地 llama.cpp bge-m3 (:8089)
└───────────────────────────────────────┘
```

- **蒸馏模型**：OpenViking 服务端用配置的 VLM 把会话蒸馏成偏好/实体/事件（每次提交消耗该 API 的 token）。
- **embedding**：OpenViking 需要 embedding 模型；仓库提供的方案是本地
  `llama.cpp llama-server` + bge-m3 Q8 GGUF（CPU 即可，不占显存，中文友好，1024 维）。

## 目录

| 路径 | 说明 |
|---|---|
| `scripts/start_openviking.ps1` | 一键启动 embedding + OpenViking（幂等，带健康检查，`-Silent` 无弹窗） |
| `scripts/stop_openviking.ps1` | 一键停止两个服务 |
| `config/ov.conf.example` | OpenViking 服务端配置模板（密钥为占位符） |
| `config/cordis-patch.web.yml` | DSH web profile 挂载片段 |
| `config/cordis-patch.unity.yml` | DSH unity profile 挂载片段（`insert:` 写法） |
| `vendor/dsh-memory-openviking/` | 上游插件 v0.4.0 源码（MIT，归原作者所有，见其 README/LICENSE） |

## 快速部署

### 1. 服务端（Windows）

```powershell
pip install openviking --upgrade          # 需要 Python 3.10+
# 下载 bge-m3 embedding 模型 (634MB, Q8_0)
mkdir E:\AI\models\bge-m3
curl -L -o E:\AI\models\bge-m3\bge-m3-Q8_0.gguf `
  https://hf-mirror.com/gpustack/bge-m3-GGUF/resolve/main/bge-m3-Q8_0.gguf
```

编辑 `config/ov.conf.example` → 保存为 `%USERPROFILE%\.openviking\ov.conf`，替换占位符：

- `<ROOT_API_KEY>` — 服务端 root key（自定；设了它即开启 `api_key` 认证）
- `<DATA_DIR>` — 记忆数据目录（如 `E:/AI/openviking/data`）
- `<VLM_MODEL>` / `<VLM_API_KEY>` / `<VLM_BASE_URL>` — 任意 OpenAI 兼容 LLM 端点（如 DeepSeek/GLM/Qwen）

先起 embedding 再起服务端（顺序由 `start_openviking.ps1` 保证）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_openviking.ps1
```

创建租户账号，拿到 **user key**（root key 只能访问管理 API，数据 API 需要 user key）：

```powershell
curl -X POST http://127.0.0.1:1933/api/v1/admin/accounts `
  -H "X-API-Key: <ROOT_API_KEY>" -H "Content-Type: application/json" `
  -d '{"account_id":"dsh","admin_user_id":"main"}'
# 返回 result.user_key —— 填入下方 DSH 配置
```

### 2. DSH 接入

把两个插件包复制进 DSH 能解析的位置（本机为共享目录，DSH 各 profile 都能解析）：

```powershell
Copy-Item -Recurse vendor\dsh-memory-openviking\packages\dsh-memory-openviking `
  $HOME\.dsh\profiles\node_modules\@deepseek-ai\dsh-memory-openviking
Copy-Item -Recurse vendor\dsh-memory-openviking\packages\dsh-tool-memory `
  $HOME\.dsh\profiles\node_modules\@deepseek-ai\dsh-tool-memory
# 运行时依赖（零传递依赖）：
npm pack @openviking/sdk@0.1.0   # 解包到 $HOME\.dsh\profiles\node_modules\@openviking\sdk
```

按 `config/cordis-patch.web.yml` / `cordis-patch.unity.yml` 把两行挂进对应 profile 的
`cordis.patch.yml`，将 `<OPENVIKING_USER_KEY>` 换成上一步的 user key。

⚠️ 插件包是纯 ESM、零构建；不要把插件包复制进 DSH 的 pnpm 依赖再跑 `pnpm install`
（会把 `@deepseek-ai/*` 核心包复制/提升成双实例，破坏 harness）——按文档手动复制即可。

重启 DSH Desktop。每个会话自动捕获 → 蒸馏 → 下次会话自动注入；也可手动调用
`memory_recall / memory_write / memory_search / memory_profile / memory_forget`。

### 3. 桌面图标（可选）

用 `scripts\start_openviking.ps1` 建一个桌面快捷方式（powershell -File，图标自定），
先点它再开 DSH。服务端必须在 DSH 之前启动（插件失败隔离，后起也会重试补上）。

## 注意事项

- **记忆互通**：web / unity 两个 profile 共用同一个 `account/user`，记忆天然互通；要隔离就换成不同 user。
- **token 开销**：每次会话蒸馏会调用 VLM API（带思维链的模型开销更大）；embedding 完全本地免费。
- **版本依赖**：OpenViking 配置字段随版本变化，装完先跑 `openviking-server --config <ov.conf>` 验证；
  OpenViking 服务端默认端口 1933（插件示例里的 18770 已过时，以实际端口为准）。
- 密钥（VLM API key、root key、user key）请使用环境变量或本地文件管理，不要提交到仓库。

## 上游

- [zouyuanqing/dsh-memory-openviking](https://github.com/zouyuanqing/dsh-memory-openviking)（插件，MIT）
- [volcengine/OpenViking](https://github.com/volcengine/OpenViking)（服务端，AGPLv3）
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）