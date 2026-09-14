# Stop the OpenViking memory backend for DSH (embedding :8089 + server :1933).
# Memory data is persisted on every commit, so stopping is safe; in-flight
# extraction tasks that have not finished are dropped and will not retry.
param(
    [int]$EmbedPort = 8089,
    [int]$OvPort = 1933,
    [switch]$Silent
)

$ErrorActionPreference = 'SilentlyContinue'
$stopped = @()
$notRunning = @()

foreach ($spec in @(@{Port = $EmbedPort; Name = 'embedding (bge-m3)'}, @{Port = $OvPort; Name = 'OpenViking server'})) {
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

Start-Sleep -Seconds 1
$left = Get-NetTCPConnection -LocalPort @($EmbedPort, $OvPort) -State Listen -ErrorAction SilentlyContinue

Add-Type -AssemblyName System.Windows.Forms
if (-not $left) {
    Write-Host "stopped: $($stopped -join ', ')"
    if (-not $Silent) {
        $msg = if ($notRunning.Count -gt 0) {
            "已关闭：$($stopped -join '、')。`n（$($notRunning -join '、')本来就没在运行）"
        } else {
            "已全部关闭：$($stopped -join '、')。已提交的记忆已持久化，不会丢失。"
        }
        [System.Windows.Forms.MessageBox]::Show($msg, 'OpenViking 已关闭', 'OK', 'Information') | Out-Null
    }
    exit 0
}
Write-Warning "some processes still listening: $($left | Out-String)"
if (-not $Silent) {
    [System.Windows.Forms.MessageBox]::Show(
        "有进程未能关闭，请手动检查端口 $EmbedPort / $OvPort。", 'OpenViking 关闭失败', 'OK', 'Error') | Out-Null
}
exit 1
