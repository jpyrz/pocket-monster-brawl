#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
local_dotnet="$repo_root/.dotnet/dotnet"

if [[ -z "${NUGET_PACKAGES:-}" || "${NUGET_PACKAGES}" != /* ]]; then
  export NUGET_PACKAGES="$repo_root/.nuget/packages"
fi

if [[ -x "$local_dotnet" ]]; then
  exec "$local_dotnet" "$@"
fi

if command -v dotnet >/dev/null 2>&1; then
  exec dotnet "$@"
fi

echo "The .NET 10 SDK is required. Install it or run the documented local SDK setup." >&2
exit 127
