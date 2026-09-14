# deploy/ - 一键部署（换机 / 重装）

这套脚本是把 OpenViking 长期记忆装到一台新 Windows 机器上的**实测版本**，
由 `deboerda/dsh-desktop-profiles` 配套使用。整套 15 分钟能跑通。

## 目录

| 文件 | 说明 |
|---|---|
| `start_openviking.ps1` | 起本地 embedding(:8089) + OpenViking(:1933)，幂等、带健康检查与超时；`-Silent` 无弹窗 |
| `stop_openviking.ps1` | 停这两个服务；**检测到 DSH Desktop 还在跑会先弹警告确认**（`-Silent` 跳过） |
| `switch-vlm.ps1` | 蒸馏 VLM 在「外部 OpenAI 兼容网关」和「本地 llama.cpp 抽取器(:8083)」之间切换 |
| `make-icons.ps1` | 生成 `icons\ov-start.ico`（绿 ▶）/ `icons\ov-stop.ico`（红 ■），多尺寸 256/48/32/16 |
| `make-shortcuts.ps1` | 在桌面创建「OpenViking记忆-启动 / -停止」两个快捷方式（含图标） |
| `ov.conf.example` | OpenViking 服务端配置模板（外部 VLM + 本地 bge-m3 1024 维 + 记忆 v2） |
| `vlm.external.example.json` | 外部蒸馏网关参数模板（`switch-vlm.ps1` 读取） |

脚本全部以 `$PSScriptRoot` 为基准目录：**把 `llama.cpp` 和模型放在脚本旁边就能用**，
也可以用 `-Root D:\ov` 指到别处。

```text
<root>\
  start_openviking.ps1  stop_openviking.ps1  switch-vlm.ps1  make-icons.ps1
  llama\bin\llama-server.exe
  models\bge-m3-Q8_0.gguf                   (embedding, 605 MB, 1024 维)
  models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf  (可选，本地抽取器回退用)
  logs\  icons\  data\
```

## 前置依赖

1. **Python 3.10+** 与 OpenViking 服务端：
   ```powershell
   pip install openviking --upgrade
   openviking-server --help        # 确认在 PATH 里；不在就加 Python 的 Scripts 目录
   ```
2. **llama.cpp**（Windows release 包，含 `llama-server.exe` 与同目录 dll）→ `<root>\llama\bin\`
3. **bge-m3 embedding 模型**（605 MB，Q8_0，1024 维）：
   ```powershell
   curl.exe -L -o <root>\models\bge-m3-Q8_0.gguf 
     https://hf-mirror.com/gpustack/bge-m3-GGUF/resolve/main/bge-m3-Q8_0.gguf
   ```
   > 校验：真实 sha256 应以 `950f4a8e` 开头、`821167` 结尾（GitHub/HF 上显示的是 xetHash，别混淆）。

## 部署步骤

1. **放好脚本与模型**，按上面的目录结构（或准备 `-Root` 参数）。
2. **写 OpenViking 配置**：把 `ov.conf.example` 复制成 `%USERPROFILE%\.openviking\ov.conf`，替换：
   - `<DATA_DIR>` — 记忆数据目录（建议和脚本同盘）
   - `<ROOT_API_KEY>` — 自己生成的 root key（开启了 `auth_mode: api_key`）
   - `<VLM_API_KEY>` / `<VLM_BASE_URL>` — 蒸馏用的 OpenAI 兼容端点
   ⚠️ 该文件必须是 **UTF-8 无 BOM**。带 BOM 会让服务端报
   `Invalid cache config: ... expected value at line 1 column 1` 而**起不来**。
   用记事本「另存为 → UTF-8」通常不加 BOM；PowerShell 里请用
   `[System.IO.File]::WriteAllText($p,$json,(New-Object System.Text.UTF8Encoding($false)))`。
3. **起服务**：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start_openviking.ps1
   ```
   幂等：已经在跑的端口会跳过；成功后弹「已就绪」。
4. **建租户并拿 user key**（root key 只能调管理 API，数据 API 要用 user key）：
   ```powershell
   curl.exe -X POST http://127.0.0.1:1933/api/v1/admin/accounts `
     -H "X-API-Key: <ROOT_API_KEY>" -H "Content-Type: application/json" `
     -d "{\"account_id\":\"dsh\",\"admin_user_id\":\"main\"}"
   # 记下返回的 user_key
   ```
   换机/换数据目录后再起服务如果报 `[UNAUTHENTICATED] Invalid API Key`，
   就是租户没跟着数据目录走，重跑这条命令即可。
5. **装 DSH 插件包**（见仓库根 README，注意**不要**跑 `pnpm install`）。
6. **挂 profile 补丁**：把 `config/cordis-patch.*.yml` 的 `- insert:` 段贴进
   `%DSH_HOME%\profiles\<profile>\cordis.patch.yml`，把 `<OPENVIKING_USER_KEY>` 换成第 4 步的 user key。
7. **建桌面快捷方式**（可选但推荐）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\make-shortcuts.ps1
   ```
8. **重启 DSH Desktop**。日常就是：双击「OpenViking记忆-启动」→ 看到「已就绪」→ 开 DSH；
   用完退出 DSH → 双击「OpenViking记忆-停止」。

## 踩过的坑（都验证过）

| 现象 | 原因 / 处理 |
|---|---|
| `failed to import loader entry memory-openviking ... cannot resolve package` 整个 plugin tree 加载失败 | 插件包不在 DSH 能解析的位置。放到共享目录 `%DSH_HOME%\profiles\node_modules\`（或每个 profile 各放一份）。**别**在 profile 里跑 `pnpm install`。 |
| 服务起来后一会儿就没了，日志 `Connection error` + `Embedding circuit breaker is open` | 从 DSH 的工具调用/前台脚本里启动过服务，调用结束时整棵进程树被 job object 回收。用桌面快捷方式、开机自启或 `schtasks /run` 启动。 |
| OpenViking 起不来，`Invalid cache config ... line 1 column 1` | `ov.conf` 带了 UTF-8 BOM。改成无 BOM。 |
| embedding 相似度整体偏低 | 别给 bge-m3 加 `--pooling mean`：该 GGUF 声明的是 CLS，强制 MEAN 会把相关/不相关相似度差从 0.475 压到 0.339。 |
| 蒸馏特别慢（几分钟）或把本地模型卡住 | 本地抽取器只在小模型上划算。有外部网关就 `switch-vlm.ps1 -StopLocal`，实测单次会话蒸馏 21 秒且不占本机 CPU。 |
| 带思维链的模型返回空内容 / 只输出 reasoning | 网关模型（如 glm-5.3-flash）把 token 全用在 reasoning 上。ov.conf 里加 `"reasoning_effort": "low"`；`enable_thinking:false`、`thinking:{type:disabled}` 这类字段网关会直接 400。 |
| PowerShell 报语法错误，明明文件看着没问题 | 脚本含中文且存的是 UTF-8 **无** BOM，Windows PowerShell 5.1 会按 ANSI 解码。存成「UTF-8 带 BOM」。 |

## 与本地大模型共存（性能）

常驻只有本地 embedding（约 0.5 GB）+ OpenViking 服务（约 0.3 GB），
`-ngl 0` 不吃显存，空闲 CPU ≈ 0%；启动脚本会把 llama-server 优先级设为 `BelowNormal`，
本地 MoE 大模型（专家跑在 CPU 上、占满物理核）永远优先。蒸馏走外部网关，本机零开销。

