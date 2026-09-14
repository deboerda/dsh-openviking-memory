# Start the OpenViking memory backend for DSH (bge-m3 embedder + OpenViking server).
# Run BEFORE DSH Desktop so the memory-openviking plugin can connect.
param(
    [int]$EmbedPort = 8089,
    [int]$OvPort = 1933,
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$root = 'E:\AI'
$llama = Join-Path $root 'llama.cpp\llama-server.exe'
$embedModel = Join-Path $root 'models\bge-m3\bge-m3-Q8_0.gguf'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-Port($port) {
    (Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue)
}

# 1. Embedding server (bge-m3, 1024 dims, CPU is enough)
if (Test-Port $EmbedPort) {
    Write-Host "embedding server already up on :$EmbedPort"
} else {
    Start-Process -FilePath $llama -ArgumentList @(
        '-m', $embedModel, '--embeddings', '--pooling', 'mean',
        '--host', '127.0.0.1', '--port', "$EmbedPort",
        '--ctx-size', '8192', '--batch-size', '512', '--threads', '8', '-ngl', '0'
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'ov-embed.out.log') -RedirectStandardError (Join-Path $logDir 'ov-embed.err.log')
    Write-Host "started embedding server on :$EmbedPort"
}

# 2. OpenViking server (reads ~/.openviking/ov.conf)
if (Test-Port $OvPort) {
    Write-Host "OpenViking already up on :$OvPort"
} else {
    Start-Process -FilePath 'openviking-server' -ArgumentList @(
        '--config', "$env:USERPROFILE\.openviking\ov.conf",
        '--host', '127.0.0.1', '--port', "$OvPort"
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'openviking.out.log') -RedirectStandardError (Join-Path $logDir 'openviking.err.log')
    Write-Host "started OpenViking on :$OvPort"
}

# 3. Wait for health
$deadline = (Get-Date).AddSeconds(60)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$OvPort/health" -TimeoutSec 3
        if ($h.healthy) { $ok = $true; break }
    } catch {}
    Start-Sleep -Seconds 2
}

Add-Type -AssemblyName System.Windows.Forms
if ($ok) {
    Write-Host "OpenViking healthy: embedding :$EmbedPort + server :$OvPort"
    if (-not $Silent) {
        [System.Windows.Forms.MessageBox]::Show(
            "OpenViking 记忆服务已就绪（embedding :$EmbedPort + server :$OvPort）。`n`n现在可以启动 DSH Desktop，web / unity 两个 profile 都会自动带上长期记忆。",
            'OpenViking 已就绪', 'OK', 'Information') | Out-Null
    }
    exit 0
}
Write-Warning 'OpenViking not healthy within 60s; check E:\AI\logs\openviking.err.log'
if (-not $Silent) {
    [System.Windows.Forms.MessageBox]::Show(
        "OpenViking 60 秒内未就绪，请查看日志：`nE:\AI\logs\openviking.err.log`nE:\AI\logs\ov-embed.err.log",
        'OpenViking 启动失败', 'OK', 'Error') | Out-Null
}
exit 1
