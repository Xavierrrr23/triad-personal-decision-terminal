# TRIAD Windows Server deployment script (run as Administrator)
# Prereq: Aliyun Lightweight console "Firewall" must allow TCP 80/443 (NOT 4317)
# Usage (inside C:\triad):
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\deploy\setup-windows.ps1 -Domain your-domain.com
# First run generates .env.local and asks you to fill TYPESAFE_API_KEY, then re-run.
# NOTE: This file is ASCII-only on purpose. PowerShell 5.1 reads .ps1 as ANSI(GBK)
# unless a BOM is present, which garbles UTF-8 comments/messages and breaks parsing.
param(
  [Parameter(Mandatory=$true)][string]$Domain
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir

function Write-Step($msg) { Write-Host "== $msg" -ForegroundColor Cyan }

# Admin check
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '[X] Please run PowerShell as Administrator.' -ForegroundColor Red; exit 1
}

Write-Step '1/8 Install Node.js LTS (if missing)'
$NodePath = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $NodePath)) {
  Write-Host 'Node not found. Downloading v24.21.0 LTS (~30MB) from a mirror...'
  # Try official first, fall back to npmmirror (fast from mainland China).
  $NodeMsi = "$env:TEMP\node.msi"
  $urls = @(
    "https://nodejs.org/dist/v24.21.0/node-v24.21.0-x64.msi",
    "https://registry.npmmirror.com/-/binary/node/v24.21.0/node-v24.21.0-x64.msi"
  )
  $ok = $false
  foreach ($u in $urls) {
    try {
      Write-Host "Trying: $u"
      Invoke-WebRequest -UseBasicParsing $u -OutFile $NodeMsi
      if ((Get-Item $NodeMsi).Length -gt 10MB) { $ok = $true; break }
    } catch { Write-Host "  failed: $($_.Exception.Message)" }
  }
  if (-not $ok) { Write-Host '[X] Node download failed from all mirrors.' -ForegroundColor Red; exit 1 }
  Start-Process msiexec -ArgumentList '/i', $NodeMsi, '/qn' -Wait
}
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
node --version
if ($LASTEXITCODE -ne 0) { Write-Host '[X] Node install failed.' -ForegroundColor Red; exit 1 }

Write-Step '2/8 Install Caddy (HTTPS reverse proxy)'
$CaddyDir = "C:\Caddy"
if (-not (Test-Path "$CaddyDir\caddy.exe")) {
  New-Item -ItemType Directory -Path $CaddyDir -Force | Out-Null
  $CaddyZip = "$env:TEMP\caddy.zip"
  $urls = @(
    "https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_windows_amd64.zip",
    "https://caddyserver.com/api/download?os=windows&arch=amd64",
    "https://ghproxy.net/https://github.com/caddyserver/caddy/releases/download/v2.11.4/caddy_2.11.4_windows_amd64.zip"
  )
  $ok = $false
  foreach ($u in $urls) {
    for ($attempt = 1; $attempt -le 2 -and -not $ok; $attempt++) {
      try {
        Write-Host "Downloading Caddy (attempt $attempt): $u"
        Invoke-WebRequest -UseBasicParsing $u -OutFile $CaddyZip
        if ((Get-Item $CaddyZip).Length -gt 10MB) {
          Expand-Archive $CaddyZip -DestinationPath $CaddyDir -Force
          if (Test-Path "$CaddyDir\caddy.exe") { $ok = $true; break }
        }
      } catch { Write-Host "  failed: $($_.Exception.Message)" }
    }
    if ($ok) { break }
  }
  if (-not $ok) { Write-Host '[X] Caddy download failed. Check network, then re-run this script.' -ForegroundColor Red; exit 1 }
}

Write-Step '3/8 Generate .env.local (fill in your key afterwards)'
$EnvPath = Join-Path $AppDir '.env.local'
if (-not (Test-Path $EnvPath)) {
  @"
TYPESAFE_API_KEY=PASTE_YOUR_KEY_HERE
PORT=4317
HOST=127.0.0.1
PUBLIC_DAILY_LIMIT=23
TRUST_PROXY=1
"@ | Set-Content -Path $EnvPath -Encoding ascii
}
if ((Get-Content $EnvPath -Raw) -match 'PASTE_YOUR_KEY_HERE') {
  Write-Host '[!] Please edit the file below, replace PASTE_YOUR_KEY_HERE with your TypeSafe key, then re-run this script.' -ForegroundColor Yellow
  Write-Host "    $EnvPath"
  Write-Host '    Quick replace (put your key inside the quotes):'
  Write-Host "    (Get-Content `"$EnvPath`") -replace 'PASTE_YOUR_KEY_HERE','YOUR_KEY' | Set-Content `"$EnvPath`""
  exit 0
}

Write-Step '4/8 Fix timezone to China Standard Time (verdict period depends on it)'
if ((Get-TimeZone).Id -ne 'China Standard Time') {
  Write-Host "Current timezone is $((Get-TimeZone).Id), switching to China Standard Time..."
  Set-TimeZone -Id 'China Standard Time'
}
Get-TimeZone | Select-Object Id, DisplayName | Format-Table -AutoSize

Write-Step '5/8 Check port 80 (disable IIS if it holds the port)'
$port80 = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
if ($port80) {
  $proc = Get-Process -Id $port80[0].OwningProcess -ErrorAction SilentlyContinue
  Write-Host "Port 80 is held by $($proc.ProcessName)."
  if (Get-Service W3SVC -ErrorAction SilentlyContinue) {
    Stop-Service W3SVC -Force
    Set-Service W3SVC -StartupType Disabled
    Write-Host 'IIS stopped and disabled.'
  } else {
    Write-Host '[X] Please stop the program holding port 80, then re-run.' -ForegroundColor Red; exit 1
  }
}

Write-Step '6/8 Open Windows Firewall for 80/443'
netsh advfirewall firewall delete rule name="TRIAD HTTP" 2>$null
netsh advfirewall firewall add rule name="TRIAD HTTP" dir=in action=allow protocol=TCP localport=80 | Out-Null
netsh advfirewall firewall delete rule name="TRIAD HTTPS" 2>$null
netsh advfirewall firewall add rule name="TRIAD HTTPS" dir=in action=allow protocol=TCP localport=443 | Out-Null

Write-Step '7/8 Register Windows services (NSSM, auto-restart on crash)'
$NssmDir = "C:\nssm"
if (-not (Test-Path "$NssmDir\nssm.exe")) {
  New-Item -ItemType Directory -Path $NssmDir -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip"
  Expand-Archive "$env:TEMP\nssm.zip" -DestinationPath $env:TEMP -Force
  Copy-Item "$env:TEMP\nssm-2.24\win64\nssm.exe" $NssmDir
}
if (Get-Service triad-node -ErrorAction SilentlyContinue) {
  & "$NssmDir\nssm.exe" set triad-node AppDirectory $AppDir | Out-Null
} else {
  & "$NssmDir\nssm.exe" install triad-node $NodePath "$AppDir\server.mjs" | Out-Null
  & "$NssmDir\nssm.exe" set triad-node AppDirectory $AppDir | Out-Null
}
& "$NssmDir\nssm.exe" set triad-node AppStdout "$AppDir\data\node.log" | Out-Null
& "$NssmDir\nssm.exe" set triad-node AppStderr "$AppDir\data\node.err.log" | Out-Null
& "$NssmDir\nssm.exe" set triad-node AppExit Default Restart | Out-Null
if (Get-Service caddy -ErrorAction SilentlyContinue) {
  & "$NssmDir\nssm.exe" set caddy AppDirectory $CaddyDir | Out-Null
} else {
  & "$NssmDir\nssm.exe" install caddy "$CaddyDir\caddy.exe" | Out-Null
  & "$NssmDir\nssm.exe" set caddy AppDirectory $CaddyDir | Out-Null
}
& "$NssmDir\nssm.exe" set caddy AppParameters "run --config `"$CaddyDir\Caddyfile`"" | Out-Null
& "$NssmDir\nssm.exe" set caddy AppStdout "$CaddyDir\caddy.log" | Out-Null
& "$NssmDir\nssm.exe" set caddy AppStderr "$CaddyDir\caddy.err.log" | Out-Null
& "$NssmDir\nssm.exe" set caddy AppExit Default Restart | Out-Null

Write-Step '8/8 Write Caddyfile and start services'
$Caddyfile = @"
$Domain {
    reverse_proxy 127.0.0.1:4317
}
"@
Set-Content -Path "$CaddyDir\Caddyfile" -Value $Caddyfile -Encoding ascii
foreach ($svc in @('triad-node','caddy')) {
  try {
    if ((Get-Service $svc).Status -eq 'Running') { Restart-Service $svc } else { Start-Service $svc }
  } catch {
    Write-Host "[X] Failed to start service $svc : $($_.Exception.Message)" -ForegroundColor Red
    if ($svc -eq 'caddy') {
      Write-Host '    Caddy may be missing or the zip was corrupted. Logs:'
      Write-Host '    Get-Content C:\Caddy\caddy.log -Tail 20'
    }
    exit 1
  }
}
Start-Sleep 8
$health = Invoke-RestMethod -UseBasicParsing "http://localhost:4317/api/health"
Write-Host "[OK] Local health check: configured=$($health.configured) version=$($health.version)" -ForegroundColor Green
Write-Host "[OK] Deployment complete: https://$Domain" -ForegroundColor Green
Write-Host '     If the site does not open: confirm the domain A record points to this public IP,'
Write-Host '     and that the Aliyun console Firewall allows TCP 80/443.'
Write-Host '     Caddy log: Get-Content C:\Caddy\caddy.log -Tail 50'
