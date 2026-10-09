# Read-only inspection of a native Windows PostgreSQL installation for DealDash local development.
# Usage (PowerShell):  powershell -ExecutionPolicy Bypass -File tooling\windows\check-postgres.ps1
# It changes nothing and never asks for or prints passwords.

$ErrorActionPreference = 'SilentlyContinue'
Write-Host '== PostgreSQL service =='
$svc = Get-Service | Where-Object { $_.Name -match 'postgres' -or $_.DisplayName -match 'PostgreSQL' }
if ($svc) { $svc | Format-Table Name, Status, StartType -AutoSize } else { Write-Host 'No PostgreSQL Windows service found.' }

Write-Host '== Installation directories =='
$dirs = Get-ChildItem 'C:\Program Files\PostgreSQL', 'C:\Program Files (x86)\PostgreSQL' -Directory
if ($dirs) { $dirs | ForEach-Object { Write-Host $_.FullName } } else { Write-Host 'No PostgreSQL install directory found under Program Files.' }

$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' | Sort-Object FullName -Descending | Select-Object -First 1
Write-Host '== psql =='
if ($psql) {
  Write-Host ("psql: " + $psql.FullName)
  & $psql.FullName --version
  $onPath = (Get-Command psql -ErrorAction SilentlyContinue)
  if ($onPath) { Write-Host 'psql is on PATH.' } else {
    $bin = Split-Path $psql.FullName
    Write-Host 'psql is NOT on PATH. Recommended (current user, no admin needed):'
    Write-Host ('  [Environment]::SetEnvironmentVariable("Path", $env:Path + ";' + $bin + '", "User")')
    Write-Host '  then open a new terminal.'
  }
  $ext = Split-Path (Split-Path $psql.FullName) -Parent
  Write-Host '== PostGIS files =='
  if (Test-Path (Join-Path $ext 'share\extension\postgis.control')) {
    $v = (Select-String -Path (Join-Path $ext 'share\extension\postgis.control') -Pattern 'default_version').Line
    Write-Host ("PostGIS extension files are installed (" + $v.Trim() + ").")
  } else {
    Write-Host 'PostGIS is NOT installed. Simplest option: run "Application Stack Builder" (Start menu, PostgreSQL group), choose Spatial Extensions > PostGIS, install, then re-run: pnpm db:postgis'
  }
  Write-Host '== pgAdmin =='
  if (Test-Path (Join-Path $ext 'pgAdmin 4')) { Write-Host 'pgAdmin 4 is installed.' } else { Write-Host 'pgAdmin 4 not found (optional).' }
} else { Write-Host 'psql.exe not found.' }

Write-Host '== Port 5432 =='
$l = Get-NetTCPConnection -LocalPort 5432 -State Listen
if ($l) { Write-Host 'Something is listening on port 5432.' } else { Write-Host 'Nothing is listening on port 5432 (is the service running?).' }
