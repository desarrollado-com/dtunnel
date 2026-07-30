#!/bin/bash
# Despliega dtunnel completo al VPS usando secretos/.env.dtunnel
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DTUNNEL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_FILE="$(cd "$DTUNNEL_ROOT/../../secretos" 2>/dev/null && pwd)/.env.dtunnel"

if [ ! -f "$SECRETS_FILE" ]; then
  echo "ERROR: No se encuentra $SECRETS_FILE"
  exit 1
fi

load_env_file() {
  local file="$1"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    printf -v "$key" '%s' "$val"
    export "$key"
  done < "$file"
}

load_env_file "$SECRETS_FILE"

DOMAIN="${DTUNNEL_DOMAIN:-dtunnel.desarrollado.com}"
REMOTE_OPT="/opt/dtunnel"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

for var in SERVER_IP ROOT_PASSWORD DTUNNEL_USER DTUNNEL_PASSWORD DTUNNEL_TOKEN DTUNNEL_PATH_PUBLIC; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Falta $var en $SECRETS_FILE"
    exit 1
  fi
done

if ! command -v sshpass >/dev/null 2>&1; then
  echo "Instala sshpass: sudo apt install sshpass"
  exit 1
fi

SSH_ROOT=(sshpass -p "$ROOT_PASSWORD" ssh -o StrictHostKeyChecking=no "${ROOT_USER}@${SERVER_IP}")
SSH_USER=(sshpass -p "$DTUNNEL_PASSWORD" ssh -o StrictHostKeyChecking=no "${DTUNNEL_USER}@${SERVER_IP}")
SCP_ROOT=(sshpass -p "$ROOT_PASSWORD" scp -o StrictHostKeyChecking=no)
SCP_USER=(sshpass -p "$DTUNNEL_PASSWORD" scp -o StrictHostKeyChecking=no)

echo "==> Preparando .env local server/"
printf 'FRPS_TOKEN=%s\nFRPS_VHOST_PORT=%s\nFRPS_BIND_PORT=7000\n' \
  "$DTUNNEL_TOKEN" "${DTUNNEL_PORT:-18080}" > "$DTUNNEL_ROOT/server/.env"

echo "==> Creando directorios en VPS"
"${SSH_ROOT[@]}" "mkdir -p $REMOTE_OPT/server $REMOTE_OPT/api ${DTUNNEL_PATH_PUBLIC}"

echo "==> Subiendo server/ y api/"
tar -C "$DTUNNEL_ROOT" -czf - server api \
  --exclude=server/.env \
  --exclude='server/frps.runtime.toml' \
  --exclude='api/node_modules' \
  --exclude='api/data' \
  | "${SSH_ROOT[@]}" "tar -xzf - -C $REMOTE_OPT"

echo "==> Subiendo web/ → public_html"
tar -C "$DTUNNEL_ROOT/web" -czf - . | "${SSH_USER[@]}" "tar -xzf - -C ${DTUNNEL_PATH_PUBLIC}"

echo "==> Escribiendo .env en servidor (frps + api)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
printf 'FRPS_TOKEN=%s\nFRPS_VHOST_PORT=%s\nFRPS_BIND_PORT=7000\n' \
  "$DTUNNEL_TOKEN" "${DTUNNEL_PORT:-18080}" > "$TMP_DIR/server.env"
printf 'PORT=3001\nJWT_SECRET=%s\nFRPS_TOKEN=%s\nFRPS_SERVER=%s\nFRPS_PORT=7000\nDOMAIN=%s\nANON_TUNNEL_LIMIT=1\nUSER_TUNNEL_LIMIT=5\n' \
  "$JWT_SECRET" "$DTUNNEL_TOKEN" "$DOMAIN" "$DOMAIN" > "$TMP_DIR/api.env"
"${SCP_ROOT[@]}" "$TMP_DIR/server.env" "${ROOT_USER}@${SERVER_IP}:${REMOTE_OPT}/server/.env"
"${SCP_ROOT[@]}" "$TMP_DIR/api.env" "${ROOT_USER}@${SERVER_IP}:${REMOTE_OPT}/api/.env"

echo "==> Plantillas Hestia"
"${SCP_ROOT[@]}" "$DTUNNEL_ROOT/server/hestia/dtunnel.stpl" "$DTUNNEL_ROOT/server/hestia/dtunnel.tpl" \
  "${ROOT_USER}@${SERVER_IP}:/usr/local/hestia/data/templates/web/nginx/"

echo "==> Instalando frps"
"${SSH_ROOT[@]}" "cd $REMOTE_OPT/server && bash install.sh"

echo "==> Construyendo API (Docker)"
"${SSH_ROOT[@]}" "cd $REMOTE_OPT/api && docker compose build && docker compose up -d"

echo "==> Reconstruyendo dominio Hestia"
"${SSH_ROOT[@]}" "v-rebuild-web-domain ${DTUNNEL_USER} ${DOMAIN} && nginx -t && systemctl reload nginx"

echo "==> Firewall puerto 7000 (si UFW activo)"
"${SSH_ROOT[@]}" "ufw allow 7000/tcp 2>/dev/null || true"

echo "==> Verificación"
"${SSH_ROOT[@]}" "cd $REMOTE_OPT/server && bash verify-vps.sh --domain ${DOMAIN} --user ${DTUNNEL_USER}" || true

echo ""
echo "Despliegue completado."
echo "  Landing:  https://${DOMAIN}"
echo "  API:      https://${DOMAIN}/api/health"
echo "  CLI:      npm install -g @desarrollado/dtunnel && dtunnel --port 88080"
