# TRIAD Windows Server 部署脚本(需管理员 PowerShell)
# 前置:轻量控制台「防火墙」放行 TCP 80/443(4317 不放行)
# 用法(项目目录 C:\triad 下):
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   .\deploy\setup-windows.ps1 -Domain 你的域名
# 首次运行会生成 .env.local 并提示填入 TYPESAFE_API_KEY, 填好后重跑一次即可。
param(
  [Parameter(Mandatory=$true)][string]$Domain
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Split-Path -Parent $ScriptDir

function Write-Step($msg) { Write-Host "== $msg" -ForegroundColor Cyan }

# 管理员检查
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host '✗ 请以管理员身份运行 PowerShell。' -ForegroundColor Red; exit 1
}

Write-Step "1/8 安装 Node.js LTS(如无)"
$NodePath = "C:\Program Files\nodejs\node.exe"
if (-not (Test-Path $NodePath)) {
  Write-Host "未安装 Node,正在下载最新 LTS(约 30MB)..."
  $lts = (Invoke-RestMethod -UseBasicParsing "https://nodejs.org/dist/index.json" | Where-Object { $_.lts } | Select-Object -First 1).version
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$lts/node-$lts-x64.msi" -OutFile "$env:TEMP\node.msi"
  Start-Process msiexec -ArgumentList '/i', "$env:TEMP\node.msi", '/qn' -Wait
}
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
node --version
if ($LASTEXITCODE -ne 0) { Write-Host '✗ Node 安装失败。' -ForegroundColor Red; exit 1 }

Write-Step "2/8 安装 Caddy(HTTPS 反向代理)"
$CaddyDir = "C:\Caddy"
if (-not (Test-Path "$CaddyDir\caddy.exe")) {
  New-Item -ItemType Directory -Path $CaddyDir -Force | Out-Null
  Invoke-WebRequest -UseBasicParsing "https://caddyserver.com/api/download?os=windows&arch=amd64" -OutFile "$env:TEMP\caddy.zip"
  Expand-Archive "$env:TEMP\caddy.zip" -DestinationPath $CaddyDir -Force
}

Write-Step "3/8 生成 .env.local(密钥需你手动填入)"
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
  Write-Host "⚠ 请先编辑 $EnvPath 填入 TYPESAFE_API_KEY,然后重新运行本脚本。" -ForegroundColor Yellow
  Write-Host '  快速替换(把末尾换成你的 Key):'
  Write-Host "  (Get-Content $EnvPath) -replace 'PASTE_YOUR_KEY_HERE','你的Key' | Set-Content $EnvPath"
  exit 0
}

Write-Step "4/8 检查时区(决议按服务器本地时间判断时段)"
if ((Get-TimeZone).Id -ne 'China Standard Time') {
  Write-Host "当前时区 $(Get-TimeZone).Id,正在切换为中国标准时间..."
  Set-TimeZone -Id 'China Standard Time'
}
Get-TimeZone | Select-Object Id, DisplayName | Format-Table -AutoSize

Write-Step "5/8 检查 80 端口(停用占用它的 IIS)"
$port80 = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
if ($port80) {
  $proc = Get-Process -Id $port80[0].OwningProcess -ErrorAction SilentlyContinue
  Write-Host "80 端口被 $($proc.ProcessName) 占用。"
  if (Get-Service W3SVC -ErrorAction SilentlyContinue) {
    Stop-Service W3SVC -Force
    Set-Service W3SVC -StartupType Disabled
    Write-Host '已停用 IIS。'
  } else {
    Write-Host '✗ 请手动停止占用 80 端口的程序后重跑。' -ForegroundColor Red; exit 1
  }
}

Write-Step "6/8 放行 Windows 防火墙 80/443"
netsh advfirewall firewall delete rule name="TRIAD HTTP" 2>$null
netsh advfirewall firewall add rule name="TRIAD HTTP" dir=in action=allow protocol=TCP localport=80 | Out-Null
netsh advfirewall firewall delete rule name="TRIAD HTTPS" 2>$null
netsh advfirewall firewall add rule name="TRIAD HTTPS" dir=in action=allow protocol=TCP localport=443 | Out-Null

Write-Step "7/8 注册 Windows 服务(NSSM 守护,崩溃自动重启)"
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

Write-Step "8/8 生成 Caddyfile 并启动服务"
$Caddyfile = @"
$Domain {
    reverse_proxy 127.0.0.1:4317
}
"@
Set-Content -Path "$CaddyDir\Caddyfile" -Value $Caddyfile -Encoding ascii
foreach ($svc in @('triad-node','caddy')) {
  if ((Get-Service $svc).Status -eq 'Running') { Restart-Service $svc } else { Start-Service $svc }
}
Start-Sleep 8
$health = Invoke-RestMethod -UseBasicParsing "http://localhost:4317/api/health"
Write-Host "✅ 本地健康检查: configured=$($health.configured) version=$($health.version)" -ForegroundColor Green
Write-Host "✅ 部署完成: https://$Domain" -ForegroundColor Green
Write-Host '   若打不开:确认域名 A 记录已指向本机公网 IP,且轻量控制台防火墙放行了 80/443。'
Write-Host '   查看日志: Get-Content C:\Caddy\caddy.log -Tail 50'
