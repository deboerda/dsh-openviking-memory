# Switch the OpenViking distillation VLM between the external OpenAI-compatible
# gateway (vlm.external.json) and the local llama.cpp extractor on :8083.
#
#   .\switch-vlm.ps1 -StopLocal     # use the external gateway, stop + disable the local extractor
#   .\switch-vlm.ps1                # apply vlm.external.json only (leaves the local extractor running)
#   .\switch-vlm.ps1 -BackToLocal   # revert to the local extractor on :8083
param(
    [switch]$StopLocal,
    [switch]$BackToLocal,
    [switch]$NoRestart
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$conf    = Join-Path $env:USERPROFILE ".openviking\ov.conf"
$extJson = Join-Path $root "vlm.external.json"
$logf    = Join-Path $root "logs\switch-vlm.log"
function Log($m) { $l = (Get-Date -Format 'HH:mm:ss') + ' ' + $m; Write-Host $l; Add-Content $logf $l }
# ov.conf must be UTF-8 WITHOUT a BOM - the Rust agfs binding rejects a BOM.
function Write-Conf($obj) {
    $json = $obj | ConvertTo-Json -Depth 10
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($conf, $json, $utf8)
}
function Restart-OvServer {
    $c = Get-NetTCPConnection -LocalPort 1933 -State Listen -ErrorAction SilentlyContinue
    if ($c) { $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Log "stopped ov-server pid $_" } }
    Start-Sleep -Seconds 3
    $cmd = Join-Path $root "start-openviking.cmd"
    & schtasks.exe /create /tn 'OVBootServer' /tr $cmd /sc once /st 23:59 /f > $null 2>&1
    & schtasks.exe /run /tn 'OVBootServer' > $null 2>&1
    Start-Sleep -Seconds 2
    & schtasks.exe /delete /tn 'OVBootServer' /f > $null 2>&1
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 2
        try { $h = Invoke-RestMethod 'http://127.0.0.1:1933/health' -TimeoutSec 5; if ($h.healthy) { Log 'ov-server healthy'; return $true } } catch {}
    }
    Log 'ov-server did NOT come back healthy'; return $false
}
$j = Get-Content $conf -Raw | ConvertFrom-Json
if ($BackToLocal) {
    $j.vlm.model    = 'local-extractor'
    $j.vlm.api_key  = 'local'
    $j.vlm.api_base = 'http://127.0.0.1:8083/v1'
    foreach ($k in @('max_tokens','reasoning_effort')) { $j.vlm.PSObject.Properties.Remove($k) }
    Write-Conf $j
    Log 'vlm -> local http://127.0.0.1:8083/v1 (local-extractor)'
    $vbs = Join-Path $root "start-extractor-hidden.vbs"
    Set-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name OpenVikingExtractor -Value ('wscript.exe "' + $vbs + '"')
    if (-not (Get-NetTCPConnection -LocalPort 8083 -State Listen -ErrorAction SilentlyContinue)) {
        & schtasks.exe /create /tn 'OVBootExtract' /tr (Join-Path $root 'start-extractor.cmd') /sc once /st 23:59 /f > $null 2>&1
        & schtasks.exe /run /tn 'OVBootExtract' > $null 2>&1
        Start-Sleep -Seconds 2
        & schtasks.exe /delete /tn 'OVBootExtract' /f > $null 2>&1
        Log 'local extractor started on :8083'
    }
    if (-not $NoRestart) { Restart-OvServer | Out-Null }
    return
}
$ext = Get-Content $extJson -Raw | ConvertFrom-Json
if (-not $ext.api_base -or $ext.api_base -like '*PUT-YOUR*') { throw ('fill api_base in ' + $extJson) }
if (-not $ext.api_key -or $ext.api_key -like '*PUT-YOUR*') { throw ('fill api_key in ' + $extJson) }
Log ('probing external VLM ' + $ext.api_base + ' model=' + $ext.model)
$body = @{ model = $ext.model; messages = @(@{ role = "user"; content = "reply with the single word: ok" }); max_tokens = 512 } | ConvertTo-Json -Depth 5
try {
    $probe = Invoke-RestMethod ($ext.api_base.TrimEnd('/') + '/chat/completions') -Method Post -TimeoutSec 90 -Headers @{ Authorization = 'Bearer ' + $ext.api_key } -ContentType 'application/json' -Body $body
    Log ('probe OK -> ' + ($probe.choices[0].message.content -replace '\s+', ' '))
} catch {
    Log ('probe FAILED: ' + $_.Exception.Message)
    throw 'external endpoint probe failed - config left untouched (check api_base / model / api_key / network)'
}
$j.vlm.model    = $ext.model
$j.vlm.api_key  = $ext.api_key
$j.vlm.api_base = $ext.api_base
if ($ext.max_tokens)       { $j.vlm | Add-Member -NotePropertyName max_tokens       -NotePropertyValue ([int]$ext.max_tokens)                -Force }
if ($ext.reasoning_effort) { $j.vlm | Add-Member -NotePropertyName reasoning_effort -NotePropertyValue ([string]$ext.reasoning_effort)      -Force }
$j | ConvertTo-Json -Depth 10 | Set-Content $conf -Encoding UTF8
Log ('vlm -> ' + $ext.api_base + ' model=' + $ext.model + ' max_tokens=' + $ext.max_tokens + ' reasoning_effort=' + $ext.reasoning_effort)
if ($StopLocal) {
    $c = Get-NetTCPConnection -LocalPort 8083 -State Listen -ErrorAction SilentlyContinue
    if ($c) { $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Log "stopped local extractor pid $_ (freed ~5.3 GB)" } }
    Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name OpenVikingExtractor -ErrorAction SilentlyContinue
    Log 'removed OpenVikingExtractor autostart entry'
}
if (-not $NoRestart) { Restart-OvServer | Out-Null }
Log 'done'
