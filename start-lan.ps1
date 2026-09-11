$ErrorActionPreference = "Stop"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Error "Docker Desktop is required. Install it from https://www.docker.com/products/docker-desktop/ and run this script again."
}

docker compose up --build --detach
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$port = if ($env:PMB_PORT) { $env:PMB_PORT } else { "3000" }
$address = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1 -ExpandProperty IPAddress

Write-Host ""
Write-Host "Pocket Monster Brawl is starting."
Write-Host "Host PC: http://localhost:$port"
if ($address) {
  Write-Host "Phones on this Wi-Fi: http://${address}:$port"
} else {
  Write-Host "Use this computer's Wi-Fi IPv4 address from another device on port $port."
}
Write-Host "Run 'docker compose logs -f app' to watch startup."
