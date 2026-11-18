param([switch]$WithMobileProtocol)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
Push-Location $project
try {
    npm.cmd run build -w @tala/web
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $env:TALA_WEB_TEST = '1'
    if ($WithMobileProtocol) {
        & (Join-Path $PSScriptRoot 'test-sync-host.ps1')
    } else {
        npm.cmd run test:postgres -w @tala/backend
    }
    exit $LASTEXITCODE
} finally {
    Remove-Item Env:TALA_WEB_TEST -ErrorAction SilentlyContinue
    Pop-Location
}
