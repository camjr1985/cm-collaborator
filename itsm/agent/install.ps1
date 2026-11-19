# CM Collaborator · Instalador do Agente de Monitoramento (Windows) – rode no PowerShell como Administrador
# © 2026 Digital Agile Technology · CM Collaborator.
# Uso: powershell -ExecutionPolicy Bypass -File install.ps1 -Token <TOKEN> -Url <URL> [-Ports "host:porta,..."] [-Services "MSSQLSERVER,W3SVC"] [-Interval 5]
#      powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
param([string]$Token = "", [string]$Url = "", [string]$Ports = "", [string]$Services = "", [int]$Interval = 5, [switch]$Uninstall)
$ErrorActionPreference = "Stop"
$site = "https://camjr1985.github.io/cm-collaborator/itsm/agent"
$dir = Join-Path $env:ProgramData "CMAgent"
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw "Abra o PowerShell como Administrador." }
if ($Uninstall) { Unregister-ScheduledTask -TaskName "CM Collaborator Agent" -Confirm:$false -ErrorAction SilentlyContinue; Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue; "Agente CM removido."; exit 0 }
if ($Token -notmatch '^[A-Za-z0-9_-]{24,80}$') { throw "Token inválido. Copie o comando de novo na aba Monitoramento." }
if ($Url -notmatch '^https://script\.google\.com/') { throw "URL inválida." }
if ($Interval -lt 5) { $Interval = 5 }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Invoke-WebRequest "$site/cm-agent.ps1" -UseBasicParsing -OutFile (Join-Path $dir "cm-agent.ps1")
@{ token = $Token; url = $Url; ports = @($Ports -split "," | Where-Object { $_ }); services = @($Services -split "," | Where-Object { $_ }) } | ConvertTo-Json | Set-Content (Join-Path $dir "config.json") -Encoding UTF8
icacls $dir /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
$act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$dir\cm-agent.ps1`""
$trg = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Interval)
Register-ScheduledTask -TaskName "CM Collaborator Agent" -Action $act -Trigger $trg -User "SYSTEM" -RunLevel Highest -Force | Out-Null
"Agendado: tarefa 'CM Collaborator Agent' a cada $Interval min."
"Primeiro envio:"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir "cm-agent.ps1")
"Pronto. Em até 1 minuto o monitor aparece 'No ar' na aba Monitoramento."
