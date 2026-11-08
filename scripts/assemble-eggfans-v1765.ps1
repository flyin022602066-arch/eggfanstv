$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previous = Join-Path $root 'release\EggfansTV-v1.7.64-windows-amd64-full'
$destination = Join-Path $root 'release\EggfansTV-v1.7.65-windows-amd64-full'
$exe = Join-Path $root 'backend\cmd\desktop\build\bin\EggfansTV.exe'
if (!(Test-Path $previous) -or !(Test-Path $exe)) { throw 'Previous full payload or current executable is missing.' }
if (Test-Path $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
Copy-Item -LiteralPath $previous -Destination $destination -Recurse -Force
Copy-Item -LiteralPath $exe -Destination (Join-Path $destination 'EggfansTV.exe') -Force
$agentDestination = Join-Path $destination 'agent-host'
Remove-Item -LiteralPath $agentDestination -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $agentDestination | Out-Null
Get-ChildItem -LiteralPath (Join-Path $root 'agent-host') -File | Where-Object {
    $_.Name -eq 'package.json' -or
    ($_.Extension -eq '.mjs' -and $_.Name -notlike '*.test.mjs' -and $_.Name -notlike '*-cases.mjs')
} | Copy-Item -Destination $agentDestination -Force
Copy-Item -LiteralPath (Join-Path $previous 'agent-host\node_modules') -Destination (Join-Path $agentDestination 'node_modules') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $previous 'agent-host\runtime') -Destination (Join-Path $agentDestination 'runtime') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $previous 'agent-host\media-runtime') -Destination (Join-Path $agentDestination 'media-runtime') -Recurse -Force
Remove-Item -LiteralPath (Join-Path $destination 'plugin-packages') -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $root 'plugin-packages') -Destination (Join-Path $destination 'plugin-packages') -Recurse -Force
Remove-Item -LiteralPath (Join-Path $destination 'skill-packages') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'backend\cmd\desktop\build\bin\skill-packages') -Destination (Join-Path $destination 'skill-packages') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $previous 'cli\beeftv.exe') -Destination (Join-Path $destination 'cli\beeftv.exe') -Force
$launcher = '@echo off`r`nsetlocal`r`nset "CANVAS_DESKTOP_DATA_DIR=%~dp0.local\EggfansTV"`r`nstart "Eggfans TV" "%~dp0EggfansTV.exe"`r`nendlocal`r`n'
Set-Content -LiteralPath (Join-Path $destination 'run-eggfans-tv.cmd') -Value $launcher -Encoding ASCII
Get-ChildItem -LiteralPath $destination -Recurse -File | Where-Object { $_.FullName -notmatch '\\manifest\.json$|\\使用说明\.txt$' } | ForEach-Object {
    $relative = $_.FullName.Substring($destination.Length + 1).Replace('\', '/')
    if ($relative -match '(^|/)\.local/EggfansTV(/|$)') { throw "User data entered payload: $relative" }
}
$records = @()
Get-ChildItem -LiteralPath $destination -Recurse -File | Where-Object { $_.Name -notin @('manifest.json', '使用说明.txt') } | ForEach-Object {
    $relative = $_.FullName.Substring($destination.Length + 1).Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $records += [ordered]@{ path = $relative; bytes = $_.Length; sha256 = $hash }
}
$manifest = [ordered]@{ version = 'v1.7.65'; platform = 'windows-amd64'; pluginPackages = @(Get-ChildItem (Join-Path $destination 'plugin-packages\*.beeftv-plugin')).Count; files = $records }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding UTF8
Write-Output ('Assembled ' + $destination + ' with ' + $records.Count + ' payload files.')
