# CM Collaborator · Agente de Monitoramento do ITSM (Windows)
# © 2026 Digital Agile Technology · CM Collaborator. Uso exclusivo de clientes do CM Collaborator.
# Envia um "batimento" (CPU, memória, disco e checks locais) por HTTPS de saída. Não abre portas.
# Configuração: C:\ProgramData\CMAgent\config.json  { token, url, ports: ["host:porta"], services: ["MSSQLSERVER"] }
$ErrorActionPreference = "Stop"
$Version = "1.0.0"
$cfgPath = Join-Path $env:ProgramData "CMAgent\config.json"
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$cpu = [math]::Round((Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average)
$os = Get-CimInstance Win32_OperatingSystem
$mem = [math]::Round(100 * ($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize)
$disk = (Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { if ($_.Size -gt 0) { [math]::Round(100 * ($_.Size - $_.FreeSpace) / $_.Size) } } | Measure-Object -Maximum).Maximum
$uptime = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalSeconds)
$checks = @()
foreach ($hp in @($cfg.ports)) {
  if (-not $hp) { continue }
  $h, $p = $hp -split ":(?=[^:]+$)"
  $c = New-Object Net.Sockets.TcpClient
  try { $ok = $c.ConnectAsync($h, [int]$p).Wait(3000) -and $c.Connected } catch { $ok = $false } finally { $c.Dispose() }
  $checks += @{ name = "porta $hp"; ok = [bool]$ok; msg = $(if ($ok) { "" } else { "sem conexão" }) }
}
foreach ($sv in @($cfg.services)) {
  if (-not $sv) { continue }
  $s = Get-Service -Name $sv -ErrorAction SilentlyContinue
  $ok = $s -and $s.Status -eq "Running"
  $checks += @{ name = "serviço $sv"; ok = [bool]$ok; msg = $(if ($s) { "$($s.Status)" } else { "não encontrado" }) }
}
$body = @{ kind = "mon-beat"; token = $cfg.token; version = "windows-$Version"; host = $env:COMPUTERNAME
  metrics = @{ cpu = $cpu; mem = $mem; disk = $disk; uptime = $uptime }; checks = $checks } | ConvertTo-Json -Depth 5 -Compress
$r = Invoke-RestMethod -Uri $cfg.url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType "text/plain; charset=utf-8" -TimeoutSec 30
"cm-agent: " + ($r | ConvertTo-Json -Compress)
