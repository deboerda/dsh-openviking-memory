# Stop the OpenViking memory backend for DSH: embedding :8089 + server :1933
# (plus the optional local extractor :8083 when running in fallback mode).
# Adapted from deboerda/dsh-openviking-memory (scripts/stop_openviking.ps1).
# Memories are persisted on every commit, so stopping is safe; an in-flight
# distillation is simply dropped.
param(
    [int]$EmbedPort = 8089,
    [int]$ExtractorPort = 8083,
    [int]$OvPort = 1933,
    [switch]$Force,
    [switch]$Silent
)

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

# 0. Safety check: DSH Desktop still running means the memory plugin loses its
#    backend and the rest of that session stops being captured.
if (-not $Silent -and -not $Force) {
    $dsh = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "*DSH*" }
    if ($dsh) {
        $names = (($dsh | Select-Object -ExpandProperty ProcessName -Unique) -join ", ")
        $msg = "检测到 DSH 仍在运行（" + $names + "）。" + [char]10 + [char]10 +
               "现在关闭记忆服务，DSH 的记忆工具会失去后端：不会丢数据，但本次会话剩下的内容不再写入记忆。" + [char]10 + [char]10 +
               "建议先退出 DSH Desktop。仍要关闭吗？"
        $answer = [System.Windows.Forms.MessageBox]::Show($msg, "DSH 还在运行", "YesNo", "Warning")
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }
    }
}

$stopped = @()
$notRunning = @()

foreach ($spec in @(
        @{ Port = $EmbedPort;     Name = 'embedding (bge-m3)'; Key = $true },
        @{ Port = $ExtractorPort; Name = 'extractor (Qwen3-4B，备用)'; Key = $false },
        @{ Port = $OvPort;        Name = 'OpenViking server'; Key = $true })) {
    $conns = Get-NetTCPConnection -LocalPort $spec.Port -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
            Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
        }
        $stopped += $spec.Name
    } else {
        $notRunning += $spec.Name
    }
}

Start-Sleep -Seconds 2
$left = Get-NetTCPConnection -LocalPort @($EmbedPort, $ExtractorPort, $OvPort) -State Listen -ErrorAction SilentlyContinue
$freeRam = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)

if (-not $left) {
    Write-Host ("stopped: " + ($stopped -join ", "))
    if (-not $Silent) {
        $tail = if ($stopped.Count -gt 0) {
            ("已关闭：" + ($stopped -join "、") + "。" + [char]10 + "已提交的记忆都在磁盘上，不会丢失。")
        } else {
            "记忆服务本来就没有在运行。"
        }
        $msg = $tail + [char]10 + [char]10 + ("当前可用内存：" + $freeRam + " GB") + [char]10 +
               "下次要用时，双击桌面「OpenViking记忆-启动」再启动 DSH Desktop 即可。"
        [System.Windows.Forms.MessageBox]::Show($msg, "OpenViking 已关闭", "OK", "Information") | Out-Null
    }
    exit 0
}
Write-Warning "some processes still listening: $($left | Out-String)"
if (-not $Silent) {
    [System.Windows.Forms.MessageBox]::Show(
        ("有进程未能关闭，请手动检查端口 " + $EmbedPort + " / " + $ExtractorPort + " / " + $OvPort + "。"), "OpenViking 关闭失败", "OK", "Error") | Out-Null
}
exit 1
