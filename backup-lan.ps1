$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path "backups" | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$containerFile = "/tmp/pmb-$timestamp.dump"
$hostFile = "backups/pmb-$timestamp.dump"

docker compose exec -T postgres pg_dump -U pmb --format=custom --file=$containerFile pmb
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose cp "postgres:${containerFile}" $hostFile
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
docker compose exec -T postgres rm -f $containerFile
Write-Host "Database backup written to $hostFile"
