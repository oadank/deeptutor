<#
修复 deeptutor nssm 服务 PATH 缺少用户路径（hermes、dsh 等找不到命令的根因）
============================================================
背景：nssm AppEnvironmentExtra 里 PATH 是**静态**的，缺了当前用户在
HKCU\Environment 里新增的若干路径（hermes venv、~/.cargo/bin、~/.local/bin、
Python Launcher、WindowsApps 等），所以服务进程里找不到 hermes/dsh 等 CLI。

用法（管理员 PowerShell 或普通用户若权限允许写 HKCU/服务）：
  1) dry-run 看将要生成的新 PATH：  powershell -ExecutionPolicy Bypass -File .\fix_deeptutor_path.ps1 -DryRun
  2) 确认后真正写入并重启：        powershell -ExecutionPolicy Bypass -File .\fix_deeptutor_path.ps1 -Apply
#>

param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$svc = 'deeptutor'

Write-Host "==> 读取 $svc 当前 AppEnvironmentExtra"
$lines = (nssm get $svc AppEnvironmentExtra) 
$pathLine = $lines | Where-Object { $_ -match '^PATH=' } | Select-Object -First 1
if (-not $pathLine) { throw "AppEnvironmentExtra 中没有 PATH 项" }
$currentPath = $pathLine -replace '^PATH=', ''

function Norm([string]$p) { ($p -replace '\\','/' -replace '/+$','').ToLower() }
$have = @{}
($currentPath -split ';' | Where-Object { $_ }) | ForEach-Object { $have[Norm $_] = $true }

# 用户 HKCU 路径里，仅补那些「真实存在」且「当前服务 PATH 没有」的条目
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
$toAdd = @()
foreach ($entry in ($userPath -split ';' | Where-Object { $_ })) {
    if ($have.ContainsKey(Norm $entry)) { continue }
    # 忽略路径里带异常字符的（如 C:\D:\opt 这种）
    if ($entry -match '\:\\.*\\' -and $entry -notmatch '^[A-Za-z]:\\.*') { 
        # 粗略跳过明显畸形路径
    }
    $toAdd += $entry
}

Write-Host ""
Write-Host "当前服务 PATH（$($currentPath -split ';' | Where-Object {$_}).Count 项）"
($currentPath -split ';' | Where-Object {$_}) | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "将新增（$($toAdd.Count) 项）:"
$toAdd | ForEach-Object { Write-Host "  + $_" }

$newPath = if ($toAdd.Count -gt 0) { ($currentPath + ';' + ($toAdd -join ';')) } else { $currentPath }

if ($DryRun) {
    Write-Host ""
    Write-Host "==> [dry-run] 新 PATH（共 $($newPath -split ';' | Where-Object {$_}).Count 项）:"
    ($newPath -split ';' | Where-Object {$_}) | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "dry-run 完成，未做修改。确认后运行:  .\fix_deeptutor_path.ps1 -Apply"
    exit 0
}

# ---- 写回 ----
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "C:\D\opt\deeptutor\nssm-$svc-appenv-$stamp.txt"
nssm get $svc AppEnvironmentExtra | Out-File -Encoding UTF8 $backup
Write-Host "==> 已备份到: $backup"

# 构造新的多行内容
$newLines = foreach ($l in $lines) {
    if ($l -match '^PATH=') { "PATH=$newPath" } else { $l }
}
$joined = $newLines -join "`n"

Write-Host "==> 写回 nssm AppEnvironmentExtra ..."
nssm set $svc AppEnvironmentExtra $joined
if ($LASTEXITCODE -ne 0) { throw "nssm set 失败 (code=$LASTEXITCODE)" }

Write-Host "==> 校验读回:"
nssm get $svc AppEnvironmentExtra | ForEach-Object { Write-Host "  $_" }

Write-Host "==> 重启 $svc ..."
nssm restart $svc
Write-Host "完成。重启后请在网页端验证 hermes / dsh 可用。"
