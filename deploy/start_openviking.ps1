# Start the OpenViking memory backend for DSH: local embedding + OpenViking server.
# Canonical copy: deboerda/dsh-openviking-memory -> deploy/start_openviking.ps1
#
# Expected layout next to this script (override the base dir with -Root):
#   <root>\llama\bin\llama-server.exe
#   <root>\models\bge-m3-Q8_0.gguf                     (embedding, 1024 dims)
#   <root>\models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf   (only with -WithLocalExtractor)
#   <root>\logs\
#
# The distillation VLM lives in %USERPROFILE%\.openviking\ov.conf - an external
# OpenAI-compatible gateway by default (switch with switch-vlm.ps1). The local
# llama.cpp extractor on :8083 is RETIRED by default: it held ~5.3 GB resident and
# competed with a local 35B model for CPU. Use -WithLocalExtractor for fallback mode.
#
# Run this BEFORE DSH Desktop so the memory-openviking plugin can connect.
param(
    [string]$Root = '',
    [int]$EmbedPort = 8089,
    [int]$OvPort = 1933,
    [int]$ExtractorPort = 8083,
    [string]$ServerExe = '',
    [switch]$WithLocalExtractor,
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = $PSScriptRoot }
if (-not $Root) { $Root = (Get-Location).Path }
$llama = Join-Path $Root 'llama\bin\llama-server.exe'
$embedModel = Join-Path $Root 'models\bge-m3-Q8_0.gguf'
$extractModel = Join-Path $Root 'models\Qwen3-4B-Instruct-2507-Q4_K_M.gguf'
$logDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Fail($msg) {
    Write-Warning $msg
    if (-not $Silent) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($msg, 'OpenViking 启动失败', 'OK', 'Error') | Out-Null
    }
    exit 1
}

function Test-Port($port) {
    (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue)
}

if (-not (Test-Path $llama)) {
    Fail ("找不到 llama-server.exe：" + $llama + "。请把 llama.cpp 解压到 <root>\llama\bin\，或用 -Root 指定基目录。")
}
if (-not (Test-Path $embedModel)) {
    Fail ("找不到 embedding 模型：" + $embedModel + "。下载 bge-m3-Q8_0.gguf 放进 <root>\models\。")
}
if (-not $ServerExe) {
    $found = Get-Command openviking-server -ErrorAction SilentlyContinue
    if ($found) { $ServerExe = $found.Source }
}
if (-not $ServerExe) {
    Fail "PATH 里找不到 openviking-server。先 pip install openviking，再把 Python 的 Scripts 目录加进 PATH，或用 -ServerExe 指定完整路径。"
}

# 1. Embedding server (bge-m3 Q8_0, 1024 dims; CPU is enough, -ngl 0).
#    No --pooling override on purpose: the GGUF declares CLS pooling, and forcing MEAN
#    measurably shrinks the related/unrelated similarity gap (0.475 -> 0.339 in tests).
if (Test-Port $EmbedPort) {
    Write-Host "embedding server already up on :$EmbedPort"
} else {
    Start-Process -FilePath $llama -ArgumentList @(
        '-m', $embedModel, '--embeddings', '--host', '127.0.0.1', '--port', "$EmbedPort",
        '--ctx-size', '8192', '--batch-size', '512', '--threads', '4', '-ngl', '0'
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'ov-embed.out.log') -RedirectStandardError (Join-Path $logDir 'ov-embed.err.log')
    Write-Host "started embedding server on :$EmbedPort"
}

# 1b. Optional local distillation VLM (fallback only - see the header note).
if ($WithLocalExtractor) {
    if (Test-Port $ExtractorPort) {
        Write-Host "extractor already up on :$ExtractorPort"
    } else {
        if (-not (Test-Path $extractModel)) { Fail ("找不到本地抽取器模型：" + $extractModel + "。") }
        Start-Process -FilePath $llama -ArgumentList @(
            '-m', $extractModel, '--host', '127.0.0.1', '--port', "$ExtractorPort",
            '-c', '8192', '-t', '4', '-b', '1024', '-ub', '1024', '-fa', 'on', '--jinja'
        ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'ov-extract.out.log') -RedirectStandardError (Join-Path $logDir 'ov-extract.err.log')
        Write-Host "started local extractor on :$ExtractorPort (fallback mode)"
    }
}

# 2. OpenViking server (reads %USERPROFILE%\.openviking\ov.conf)
if (Test-Port $OvPort) {
    Write-Host "OpenViking already up on :$OvPort"
} else {
    Start-Process -FilePath $ServerExe -ArgumentList @(
        '--config', "$env:USERPROFILE\.openviking\ov.conf",
        '--host', '127.0.0.1', '--port', "$OvPort"
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'openviking.out.log') -RedirectStandardError (Join-Path $logDir 'openviking.err.log')
    Write-Host "started OpenViking on :$OvPort"
}

# 2b. Yield to the user's local LLM: a local MoE model runs its experts on all
#     physical cores, so BelowNormal makes it win every CPU contest.
Start-Sleep -Seconds 3
Get-Process llama-server -ErrorAction SilentlyContinue | ForEach-Object {
    $cl = (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $_.Id) -ErrorAction SilentlyContinue).CommandLine
    if ($cl -match 'bge-m3|Qwen3-4B') { try { $_.PriorityClass = 'BelowNormal' } catch {} }
}

# 3. Wait for health
$deadline = (Get-Date).AddSeconds(120)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$OvPort/health" -TimeoutSec 3
        if ($h.healthy) { $ok = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
}

if ($ok) {
    Write-Host "OpenViking healthy: embedding :$EmbedPort + VLM (ov.conf) + server :$OvPort"
    if (-not $Silent) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            ("OpenViking 记忆服务已就绪。" + [char]10 + [char]10 +
             "embedding bge-m3 本地 :" + $EmbedPort + [char]10 +
             "蒸馏 VLM 见 ov.conf（默认外部网关）" + [char]10 +
             "OpenViking server :" + $OvPort + [char]10 + [char]10 +
             "现在可以启动 DSH Desktop，各 profile 都会自动带上长期记忆。"),
            'OpenViking 已就绪', 'OK', 'Information') | Out-Null
    }
    exit 0
}
Write-Warning "OpenViking not healthy within 120s; check $logDir\openviking.err.log"
if (-not $Silent) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        ("OpenViking 120 秒内未就绪，请查看日志：" + $logDir + "\openviking.err.log 与 " + $logDir + "\ov-embed.err.log"),
        'OpenViking 启动失败', 'OK', 'Error') | Out-Null
}
exit 1
