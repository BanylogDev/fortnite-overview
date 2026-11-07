$ErrorActionPreference = "Stop"

$engineDirectory = Split-Path -Parent $PSScriptRoot
$runtimeDirectory = Join-Path $engineDirectory "Runtime"

$bundledNode = Join-Path $runtimeDirectory "node.exe"
$bundledNpm = Join-Path $runtimeDirectory "npm.cmd"

if ((Test-Path $bundledNode) -and (Test-Path $bundledNpm)) {
    $nodeVersionText = & $bundledNode --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $nodeVersionText -match '^v?(\d+)\.') {
        if ([int]$Matches[1] -ge 22) {
            Write-Host "Bundled Node.js and npm are ready."
            exit 0
        }
    }
} elseif (-not (Test-Path $bundledNode) -and -not (Test-Path $bundledNpm)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue

    if ($nodeCommand -and $npmCommand) {
        $nodeVersionText = & $nodeCommand.Source --version 2>$null
        if ($LASTEXITCODE -eq 0 -and $nodeVersionText -match '^v?(\d+)\.') {
            if ([int]$Matches[1] -ge 22) {
                Write-Host "System Node.js and npm are ready."
                exit 0
            }
        }
    }
}

Write-Host "Node.js 22+ with npm was not found. Downloading the official portable runtime..."

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $architecture = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) {
        $architecture = $env:PROCESSOR_ARCHITEW6432
    }
    $nodeArchitecture = if ($architecture -eq "ARM64") { "arm64" } else { "x64" }
    $archiveArchitecture = "win-$nodeArchitecture-zip"

    $releaseIndex = Invoke-RestMethod `
        -Uri "https://nodejs.org/dist/index.json" `
        -TimeoutSec 45
    $release = $releaseIndex |
        Where-Object { $_.lts -and $_.files -contains $archiveArchitecture } |
        Select-Object -First 1

    if (-not $release) {
        throw "No stable Node.js LTS ZIP was found for Windows $nodeArchitecture."
    }

    $version = $release.version
    $archiveName = "node-$version-win-$nodeArchitecture.zip"
    $downloadUrl = "https://nodejs.org/dist/$version/$archiveName"
    $temporaryDirectory = Join-Path $env:TEMP ([guid]::NewGuid().ToString("N"))
    $archivePath = Join-Path $temporaryDirectory $archiveName
    $extractDirectory = Join-Path $temporaryDirectory "expanded"

    New-Item -ItemType Directory -Path $temporaryDirectory, $extractDirectory -Force | Out-Null
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -TimeoutSec 180 -UseBasicParsing
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force

    $runtimeSource = Get-ChildItem -LiteralPath $extractDirectory -Directory | Select-Object -First 1
    if (-not $runtimeSource -or -not (Test-Path (Join-Path $runtimeSource.FullName "npm.cmd"))) {
        throw "The downloaded Node.js archive did not contain npm."
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    Copy-Item -Path (Join-Path $runtimeSource.FullName "*") -Destination $runtimeDirectory -Recurse -Force

    if (-not (Test-Path (Join-Path $runtimeDirectory "node.exe")) -or
        -not (Test-Path (Join-Path $runtimeDirectory "npm.cmd"))) {
        throw "Node.js and npm were not installed correctly."
    }

    Write-Host "Node.js $version and npm are ready."
    exit 0
}
catch {
    Write-Error "Automatic Node.js/npm setup failed: $($_.Exception.Message)"
    exit 1
}
finally {
    if ($temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
