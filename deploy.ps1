param(
  [switch]$Lan,
  [switch]$NoBrowser,
  [switch]$NonInteractive,
  [switch]$Doctor
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$bindHost = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
$scope = if ($Lan) { '局域网' } else { '本机' }
$envFile = Join-Path $root '.env.local'

function Invoke-Npm([string]$arguments, [string]$registry = '') {
  # Out-Host keeps npm's output on screen instead of in this function's return value.
  $command = 'cd /d "' + $root + '" && npm ' + $arguments
  if ($registry) { $command += ' --registry=' + $registry }
  & cmd.exe /d /c $command | Out-Host
  return $LASTEXITCODE
}

function Get-NpmOutput([string]$arguments) {
  $command = 'cd /d "' + $root + '" && npm ' + $arguments
  return (& cmd.exe /d /c $command 2>$null | Select-Object -Last 1)
}

function Write-Step([string]$text) { Write-Host $text -ForegroundColor Cyan }
function Write-Warn([string]$text) { Write-Host $text -ForegroundColor Yellow }
function Exit-Fail([string]$text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Red
  exit 1
}

function Read-EnvValue([string]$name) {
  if (-not (Test-Path -LiteralPath $envFile)) { return $null }
  $match = Select-String -LiteralPath $envFile -Pattern ("^" + [regex]::Escape($name) + "=(.+)$") -Encoding utf8 |
    Select-Object -First 1
  if ($match) { return $match.Matches[0].Groups[1].Value.Trim() }
  return $null
}

function Set-EnvValue([string]$name, [string]$value) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $lines = if (Test-Path -LiteralPath $envFile) { @(Get-Content -LiteralPath $envFile -Encoding utf8) } else { @() }
  $done = $false
  $out = foreach ($line in $lines) {
    if (-not $done -and $line -match ('^' + [regex]::Escape($name) + '=')) {
      $done = $true
      "$name=$value"
    } else {
      $line
    }
  }
  $out = @($out)
  if (-not $done) { $out += "$name=$value" }
  [System.IO.File]::WriteAllLines($envFile, $out, $utf8)
}

function Read-Secret([string]$prompt) {
  $secure = Read-Host -AsSecureString $prompt
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Confirm-EnvKey([string]$name, [string]$description) {
  if (Read-EnvValue $name) { return }
  Write-Host ''
  Write-Host "       缺少 ${name}：$description"
  if ($NonInteractive) {
    Write-Host '       已跳过（非交互模式），稍后可编辑 .env.local。'
    return
  }
  $value = Read-Secret "       粘贴后回车；留空跳过，稍后可编辑 .env.local"
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host '       已跳过，未配置时相关功能会提示服务未配置。'
    return
  }
  Set-EnvValue $name $value.Trim()
  Write-Host '       已写入 .env.local。'
}

function Test-PortBusy([int]$port) {
  $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  return [bool]$listeners
}

# Never call `npm` bare from PowerShell: it resolves to npm.ps1, which the machine's
# execution policy can forbid. cmd.exe resolves npm.cmd (a batch shim) instead.
Write-Host '=================================================='
Write-Host "  行间 · AI 旅行规划工作台   一键部署（${scope}访问）"
Write-Host '=================================================='
Write-Host ''

if (-not (Test-Path -LiteralPath (Join-Path $root 'package.json'))) {
  Exit-Fail '[错误] 本脚本不在项目根目录，请把它与 package.json 放在同一目录。'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Exit-Fail '[错误] 未检测到 Node.js，请先安装 Node.js 24：https://nodejs.org/'
}
$nodeVersion = (& node -v).Trim()
$nodeMajor = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($nodeMajor -ne 24) {
  Write-Warn "[警告] 当前 Node 版本为 $nodeVersion，项目要求 24.x，继续可能失败。"
  Write-Host ''
}

if ($Doctor) {
  Write-Step '[诊断] 环境信息（把下面这段发回即可）'
  Write-Host ("       Node      : " + $nodeVersion)
  Write-Host ("       npm       : " + (Get-NpmOutput '-v'))
  Write-Host ("       依赖源    : " + (Get-NpmOutput 'config get registry'))
  Write-Host ("       项目目录  : " + $root)
  Write-Host ("       package   : " + (Test-Path -LiteralPath (Join-Path $root 'package.json')))
  $nextPackage = Join-Path (Join-Path (Join-Path $root 'node_modules') 'next') 'package.json'
  Write-Host ("       node_modules: " + (Test-Path -LiteralPath $nextPackage))
  Write-Host ("       .env.local: " + (Test-Path -LiteralPath $envFile))
  foreach ($key in @('AMAP_WEB_SERVICE_KEY', 'NEXT_PUBLIC_AMAP_JS_KEY', 'AMAP_JS_SECURITY_CODE', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY')) {
    $present = if (Read-EnvValue $key) { '已配置' } else { '缺失' }
    Write-Host ("       " + $key + ': ' + $present)
  }
  Write-Host ("       3000 端口 : " + $(if (Test-PortBusy 3000) { '被占用' } else { '空闲' }))
  exit 0
}

Write-Step '[1/4] 检查依赖...'
if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\next\package.json'))) {
  Write-Host '       首次运行：正在安装依赖，通常 1—3 分钟；下载期间没有新输出是正常现象。'
  $installArgs = 'ci --no-audit --no-fund --fetch-retries=2 --fetch-timeout=120000'
  Push-Location $root
  $code = Invoke-Npm $installArgs
  Pop-Location
  if ($code -ne 0) {
    Write-Warn '       默认依赖源安装失败，改用国内镜像重试一次。'
    Push-Location $root
    $code = Invoke-Npm $installArgs 'https://registry.npmmirror.com'
    Pop-Location
  }
  if ($code -ne 0) {
    Exit-Fail '[错误] 依赖安装失败，请检查网络或代理；也可以运行本脚本加 -Doctor 查看环境。'
  }
} else {
  Write-Host '       已安装，跳过。'
}

Write-Step '[2/4] 检查密钥配置...'
if (-not (Test-Path -LiteralPath $envFile)) {
  Copy-Item -LiteralPath (Join-Path $root '.env.example') -Destination $envFile
  Write-Host '       已由 .env.example 创建 .env.local。'
}
Confirm-EnvKey 'AMAP_WEB_SERVICE_KEY' '高德 Web 服务 Key，服务端调用地点与路线'
Confirm-EnvKey 'NEXT_PUBLIC_AMAP_JS_KEY' '高德 JS API Key，浏览器地图'
Confirm-EnvKey 'AMAP_JS_SECURITY_CODE' '高德 JS 安全密钥'
if (-not (Read-EnvValue 'OPENAI_API_KEY') -and -not (Read-EnvValue 'DEEPSEEK_API_KEY')) {
  Write-Host ''
  Write-Host '       缺少模型密钥：OPENAI_API_KEY 或 DEEPSEEK_API_KEY 任意一个即可。'
  Confirm-EnvKey 'DEEPSEEK_API_KEY' 'DeepSeek 或其它 OpenAI 兼容服务的 Key'
}
Write-Host '       检查完成，密钥只写在本机 .env.local，不会提交到 Git。'

Write-Step '[3/4] 构建生产版本...'
Push-Location $root
$code = Invoke-Npm 'run build'
Pop-Location
if ($code -ne 0) {
  Exit-Fail '[错误] 构建失败，请查看上方输出。'
}

$port = 3000
while (Test-PortBusy $port) {
  $port = $port + 1
  if ($port -gt 3010) {
    Exit-Fail '[错误] 3000 至 3010 端口都被占用，请先关闭占用程序。'
  }
}

Write-Step '[4/4] 启动服务...'
$serveArgs = "run start -- --hostname $bindHost -p $port"
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "npm $serveArgs" -WorkingDirectory $root

$url = "http://127.0.0.1:$port"
$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "$url/"
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch {
    Start-Sleep -Milliseconds 700
  }
}
if (-not $ready) {
  Exit-Fail '[错误] 服务在 45 秒内没有响应，请查看服务窗口中的报错信息。'
}

if (-not $NoBrowser) { Start-Process $url }

Write-Host ''
Write-Host '=================================================='
Write-Host "  已启动：$url"
if ($Lan) {
  $lanIp = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' -and
      $_.IPAddress -ne '198.18.0.1'
    } |
    Select-Object -First 1 -ExpandProperty IPAddress
  if ($lanIp) {
    Write-Host "  局域网地址：http://${lanIp}:$port"
    Write-Host '  首次访问需在 Windows 防火墙提示中允许 Node.js。'
    Write-Host '  高德 JS Key 必须把该地址加入域名白名单，否则地图显示不可用。'
  } else {
    Write-Host '  未检测到局域网 IPv4 地址，请用 ipconfig 查看后手动访问。'
  }
}
Write-Host '  服务在单独的窗口运行，关闭那个窗口即停止服务。'
Write-Host '  本窗口可以直接关闭。'
Write-Host '=================================================='
if (-not $NoBrowser) { Read-Host '按回车关闭本窗口' | Out-Null }
exit 0
