#!/bin/bash
# Genera frps.json desde .env y levanta el broker
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { cp .env.example .env; echo "Edita .env y vuelve a ejecutar"; exit 1; }

load_env_file() {
  local file="$1"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    printf -v "$key" '%s' "$val"
    export "$key"
  done < "$file"
}
load_env_file .env

[ -n "${FRPS_TOKEN:-}" ] || { echo "FRPS_TOKEN vacío en .env"; exit 1; }
VHOST_PORT="${FRPS_VHOST_PORT:-18080}"
export FRPS_TOKEN FRPS_VHOST_PORT="$VHOST_PORT"

python3 - <<'PY'
import json
import os
from pathlib import Path

token = os.environ["FRPS_TOKEN"]
port = int(os.environ.get("FRPS_VHOST_PORT", "18080"))
config = {
    "bindAddr": "0.0.0.0",
    "bindPort": 7000,
    "auth": {"method": "token", "token": token},
    "vhostHTTPPort": port,
    "subDomainHost": "dtunnel.desarrollado.com",
    "webServer": {
        "addr": "127.0.0.1",
        "port": 7500,
        "user": "admin",
        "password": "cambia-esto",
    },
    "log": {"to": "console", "level": "info"},
}
Path("frps.runtime.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
PY

docker compose --env-file .env up -d
echo "frps en puertos 7000 (control) y ${VHOST_PORT} (HTTP vhost)"
