param([string]$JdkPath = $env:TALA_JAVA_HOME, [string]$SdkPath = $env:ANDROID_HOME, [string]$Architectures = 'arm64-v8a,armeabi-v7a')
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (-not $JdkPath) { $JdkPath = Join-Path $env:USERPROFILE '.gradle/jdks/eclipse_adoptium-21-amd64-windows.2' }
if (-not (Test-Path -LiteralPath (Join-Path $JdkPath 'bin/java.exe'))) { throw 'Set TALA_JAVA_HOME to JDK 17 or 21.' }
if (-not $SdkPath) { $SdkPath = $env:ANDROID_SDK_ROOT }
if (-not $SdkPath -or -not (Test-Path -LiteralPath (Join-Path $SdkPath 'platform-tools/adb.exe'))) { throw 'Set ANDROID_HOME to the Android SDK.' }
$env:JAVA_HOME = $JdkPath
$env:ANDROID_HOME = $SdkPath
$env:ANDROID_USER_HOME = Join-Path $repoPath '.cache/android'
$env:NODE_ENV = 'production'
$env:CI = '1'
if (-not (Test-Path -LiteralPath (Join-Path $repoPath 'apps/scanner/android/gradlew.bat'))) { throw 'Run npm.cmd run build:android first to prepare the native project.' }
Push-Location (Join-Path $repoPath 'apps/scanner/android')
try {
  & .\gradlew.bat :tala-ocr:connectedDebugAndroidTest "-PreactNativeArchitectures=$Architectures" '-Dorg.gradle.workers.max=2' --no-daemon --console=plain |
    Tee-Object -FilePath (Join-Path $repoPath 'docs/evidence/android-instrumentation-build.log')
  if ($LASTEXITCODE -ne 0) { throw 'Native Android tests failed or could not execute. Inspect the connected-test report; do not mark phone acceptance passed.' }
} finally { Pop-Location }
