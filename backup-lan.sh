#!/usr/bin/env bash
set -euo pipefail

mkdir -p backups
timestamp="$(date +%Y%m%d-%H%M%S)"
container_file="/tmp/pmb-${timestamp}.dump"
host_file="backups/pmb-${timestamp}.dump"

docker compose exec -T postgres pg_dump -U pmb --format=custom --file="$container_file" pmb
docker compose cp "postgres:${container_file}" "$host_file"
docker compose exec -T postgres rm -f "$container_file"
echo "Database backup written to ${host_file}"
