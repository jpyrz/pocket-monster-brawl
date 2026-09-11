#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is required. Install it from https://www.docker.com/products/docker-desktop/ and run this again."
  exit 1
fi

docker compose up --build --detach

lan_ip=""
if command -v ipconfig >/dev/null 2>&1; then
  lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
elif command -v hostname >/dev/null 2>&1; then
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi

echo
echo "Pocket Monster Brawl is starting."
echo "Host PC: http://localhost:${PMB_PORT:-3000}"
if [ -n "$lan_ip" ]; then
  echo "Phones on this Wi-Fi: http://${lan_ip}:${PMB_PORT:-3000}"
else
  echo "Use this computer's Wi-Fi IPv4 address from another device on port ${PMB_PORT:-3000}."
fi
echo "Run 'docker compose logs -f app' to watch startup."
