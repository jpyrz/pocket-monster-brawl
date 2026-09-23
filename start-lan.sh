#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker Desktop is required. Install it from https://www.docker.com/products/docker-desktop/ and run this again."
  exit 1
fi

docker compose up --build --detach

port="${PMB_PORT:-3000}"
lan_host="${PMB_HOSTNAME:-}"
if [ -z "$lan_host" ] && command -v scutil >/dev/null 2>&1; then
  lan_host="$(scutil --get LocalHostName 2>/dev/null || true)"
fi
if [ -z "$lan_host" ] && command -v hostname >/dev/null 2>&1; then
  lan_host="$(hostname -s 2>/dev/null || true)"
fi
lan_host="${lan_host%.local}"

lan_ip=""
if command -v ipconfig >/dev/null 2>&1; then
  lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
elif command -v hostname >/dev/null 2>&1; then
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi

echo
echo "Pocket Monster Brawl is starting."
echo "Host PC: http://localhost:${port}"
if [ -n "$lan_host" ]; then
  echo "Phones on this Wi-Fi (stable): http://${lan_host}.local:${port}"
fi
if [ -n "$lan_ip" ]; then
  echo "IP fallback: http://${lan_ip}:${port}"
else
  echo "If the .local address is unavailable, use this computer's Wi-Fi IPv4 address on port ${port}."
fi
echo "Run 'docker compose logs -f app' to watch startup."
