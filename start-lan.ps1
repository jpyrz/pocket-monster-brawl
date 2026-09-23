$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker Desktop is required. Install it from https://www.docker.com/products/docker-desktop/ and run this script again."
}

docker compose up --build --detach
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$port = if ($env:PMB_PORT) { $env:PMB_PORT } else { "3000" }
$hostName = if ($env:PMB_HOSTNAME) { $env:PMB_HOSTNAME } else { [System.Net.Dns]::GetHostName() }
$hostName = $hostName -replace '\.local$', ''
$address = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
Write-Host "Pocket Monster Brawl is starting."
Write-Host "Host PC: http://localhost:$port"
if ($hostName) {
  Write-Host "Phones on this Wi-Fi (stable when mDNS is available): http://${hostName}.local:$port"
}
if ($address) {
  Write-Host "IP fallback: http://${address}:$port"
} else {
  Write-Host "If the .local address is unavailable, use this computer's Wi-Fi IPv4 address on port $port."
}
Write-Host "Run 'docker compose logs -f app' to watch startup."
