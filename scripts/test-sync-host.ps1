param(
    [string]$GradleCache = (Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'),
    [string]$Java = 'java'
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$separator = [IO.Path]::PathSeparator
$out = Join-Path $project '.cache/tala-sync-host'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Find-GradleJar([string]$Group, [string]$Name, [string]$Version) {
    $folder = Join-Path $GradleCache "$Group/$Name/$Version"
    $jar = Get-ChildItem -LiteralPath $folder -Recurse -File -Filter "$Name-$Version.jar" | Select-Object -First 1
    if (!$jar) { throw "Missing cached artifact $Group/$Name/$Version" }
    return $jar.FullName
}

$stdlib = Find-GradleJar org.jetbrains.kotlin kotlin-stdlib 2.2.0
$annotations = Find-GradleJar org.jetbrains annotations 23.0.0
$compiler = @(
    (Find-GradleJar org.jetbrains.kotlin kotlin-compiler-embeddable 2.2.0)
    $stdlib
    (Find-GradleJar org.jetbrains.kotlin kotlin-script-runtime 2.2.0)
    (Find-GradleJar org.jetbrains.kotlin kotlin-reflect 1.6.10)
    (Find-GradleJar org.jetbrains.kotlin kotlin-daemon-embeddable 2.2.0)
    (Find-GradleJar org.jetbrains.kotlinx kotlinx-coroutines-core-jvm 1.8.0)
    $annotations
) -join $separator
$runtime = @(
    $stdlib
    $annotations
    (Find-GradleJar com.squareup.okhttp3 okhttp 4.12.0)
    (Find-GradleJar com.squareup.okio okio-jvm 3.6.0)
    (Find-GradleJar org.json json 20180813)
) -join $separator
$native = Join-Path $project 'apps/scanner/modules/tala-sync/android/src/main/java/expo/modules/talasync'
$classes = Join-Path $out 'protocol.jar'
$sources = @(
    (Join-Path $native 'SyncProtocol.kt')
    (Join-Path $native 'SyncApi.kt')
    (Join-Path $native 'EncoderSession.kt')
    (Join-Path $project 'apps/scanner/tests/SyncHost.kt')
)
& $Java -cp $compiler org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -jvm-target 17 -classpath $runtime -d $classes @sources
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:TALA_SYNC_HOST_CLASSPATH = $classes + $separator + $runtime
$env:TALA_SYNC_HOST_JAVA = $Java
Push-Location $project
try {
    npm.cmd run test:postgres -w @tala/backend
    exit $LASTEXITCODE
} finally {
    Pop-Location
    Remove-Item Env:TALA_SYNC_HOST_CLASSPATH, Env:TALA_SYNC_HOST_JAVA
}
