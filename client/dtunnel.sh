#!/usr/bin/env bash
# Redirige al CLI npm global (v2). Ver install/dtunnel/install para instalación.
set -euo pipefail
if command -v dtunnel >/dev/null 2>&1; then
  real_dtunnel="$(command -v dtunnel)"
  if [ "$real_dtunnel" != "$0" ]; then
    exec "$real_dtunnel" "$@"
  fi
fi
echo "ERROR: dtunnel no instalado." >&2
echo "Ejecuta: npm install -g @desarrollado/dtunnel" >&2
echo "O: curl -O https://install.desarrollado.com/dtunnel/install && sudo bash install" >&2
exit 1
