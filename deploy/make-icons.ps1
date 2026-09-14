# Generate the OpenViking start/stop shortcut icons (multi-size PNG-in-ICO).
# ASCII only on purpose: the DSH pwsh tool runs Windows PowerShell 5.1, which
# decodes BOM-less files as ANSI and would break on non-ASCII source.
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path $PSScriptRoot 'icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-IconBitmap([int]$size, [System.Drawing.Color]$bg, [string]$symbol) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $pad = [Math]::Max(1, [int]($size * 0.05))
    $d = $size - 2 * $pad
    $ring = New-Object System.Drawing.SolidBrush($bg)
    $g.FillEllipse($ring, $pad, $pad, $d, $d)
    $hi = [System.Drawing.Color]::FromArgb(60, 255, 255, 255)
    $hb = New-Object System.Drawing.SolidBrush($hi)
    $g.FillEllipse($hb, $pad, $pad, $d, [int]($d * 0.55))
    $wb = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    if ($symbol -eq "play") {
        $cx = $size / 2.0
        $cy = $size / 2.0
        $r = $size * 0.23
        $pts = New-Object "System.Drawing.PointF[]" 3
        $pts[0] = New-Object System.Drawing.PointF(($cx - $r * 0.60), ($cy - $r))
        $pts[1] = New-Object System.Drawing.PointF(($cx - $r * 0.60), ($cy + $r))
        $pts[2] = New-Object System.Drawing.PointF(($cx + $r * 0.95), $cy)
        $g.FillPolygon($wb, $pts)
    } else {
        $s = [Math]::Max(3, [int]($size * 0.40))
        $g.FillRectangle($wb, [int](($size - $s) / 2), [int](($size - $s) / 2), $s, $s)
    }
    $g.Dispose()
    return $bmp
}

function Write-Ico([string]$path, $bitmaps) {
    $pngs = @()
    foreach ($b in $bitmaps) {
        $m = New-Object System.IO.MemoryStream
        $b.Save($m, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngs += , $m.ToArray()
        $m.Dispose()
    }
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($ms)
    $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$bitmaps.Count)
    $offset = 6 + 16 * $bitmaps.Count
    for ($i = 0; $i -lt $bitmaps.Count; $i++) {
        $b = $bitmaps[$i]
        $w = if ($b.Width -ge 256) { 0 } else { $b.Width }
        $h = if ($b.Height -ge 256) { 0 } else { $b.Height }
        $bw.Write([Byte]$w); $bw.Write([Byte]$h); $bw.Write([Byte]0); $bw.Write([Byte]0)
        $bw.Write([UInt16]1); $bw.Write([UInt16]32)
        $bw.Write([UInt32]$pngs[$i].Length); $bw.Write([UInt32]$offset)
        $offset += $pngs[$i].Length
    }
    foreach ($p in $pngs) { $bw.Write($p) }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
    $bw.Dispose(); $ms.Dispose()
}

$sizes = @(256, 48, 32, 16)
$green = [System.Drawing.Color]::FromArgb(255, 31, 139, 76)
$red = [System.Drawing.Color]::FromArgb(255, 176, 58, 46)

foreach ($spec in @(@{ name = "ov-start"; color = $green; sym = "play" }, @{ name = "ov-stop"; color = $red; sym = "stop" })) {
    $bmps = @()
    foreach ($s in $sizes) { $bmps += (New-IconBitmap -size $s -bg $spec.color -symbol $spec.sym) }
    Write-Ico -path (Join-Path $outDir ($spec.name + ".ico")) -bitmaps $bmps
    $bmps[0].Save((Join-Path $outDir ($spec.name + "-preview.png")), [System.Drawing.Imaging.ImageFormat]::Png)
    foreach ($b in $bmps) { $b.Dispose() }
    Write-Host ("wrote " + $spec.name + ".ico")
}
Get-ChildItem $outDir | ForEach-Object { Write-Host ("  " + $_.Name + "  " + $_.Length + "B") }
