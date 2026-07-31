#!/bin/bash
# Verifica en el VPS la configuración del túnel nativo dtunnel.
# Uso: cd /opt/dtunnel/server && bash verify-vps.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DTUNNEL_DOMAIN="${DTUNNEL_DOMAIN:-dtunnel.desarrollado.com}"
HESTIA_USER="${HESTIA_USER:-desarrollado}"
GATEWAY_PORT="${TUNNEL_HTTP_PORT:-18080}"
API_CONTAINER="${DTUNNEL_API_CONTAINER:-dtunnel_api}"
HESTIA_TPL_DIR="${HESTIA_TPL_DIR:-/usr/local/hestia/data/templates/web/nginx}"

ok=0
warn=0
fail=0

section() { echo ""; echo "=== $1 ==="; }
c_ok() { echo "  OK   $1"; ok=$((ok + 1)); }
c_warn() { echo "  WARN $1"; warn=$((warn + 1)); }
c_fail() { echo "  FAIL $1"; fail=$((fail + 1)); }

port_listening() {
  ss -tln 2>/dev/null | grep -q ":$1 " || netstat -tln 2>/dev/null | grep -q ":$1 "
}

section "API Docker"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$API_CONTAINER"; then
  c_ok "Contenedor $API_CONTAINER en ejecución"
else
  c_fail "Contenedor $API_CONTAINER no está corriendo (cd /opt/dtunnel/api && docker compose up -d)"
fi

section "Gateway túnel (:${GATEWAY_PORT})"
if port_listening "$GATEWAY_PORT"; then
  c_ok "Puerto ${GATEWAY_PORT} escuchando (gateway nativo en la API)"
else
  c_fail "Puerto ${GATEWAY_PORT} no escucha — Nginx dará 502 en subdominios"
fi

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx dtunnel_frps; then
  c_warn "Contenedor legacy dtunnel_frps aún existe — ejecuta: docker rm -f dtunnel_frps"
fi

section "Plantillas Hestia"
for tpl in dtunnel.stpl dtunnel.tpl; do
  if [ -f "${HESTIA_TPL_DIR}/${tpl}" ]; then
    if grep -q "127.0.0.1:${GATEWAY_PORT}" "${HESTIA_TPL_DIR}/${tpl}"; then
      c_ok "${tpl} → 127.0.0.1:${GATEWAY_PORT}"
    else
      c_warn "${tpl} instalada pero sin proxy a :${GATEWAY_PORT}"
    fi
  else
    c_fail "Falta ${HESTIA_TPL_DIR}/${tpl}"
  fi
done

section "Nginx dominio"
NGINX_SSL_CONF="/etc/nginx/conf.d/domains/${DTUNNEL_DOMAIN}.ssl.conf"
if [ -f "$NGINX_SSL_CONF" ] && grep -q "127.0.0.1:${GATEWAY_PORT}" "$NGINX_SSL_CONF"; then
  c_ok "Nginx SSL proxy a gateway :${GATEWAY_PORT}"
elif [ -f "$NGINX_SSL_CONF" ]; then
  c_warn "Nginx SSL sin proxy a :${GATEWAY_PORT} — asigna plantilla dtunnel y v-rebuild"
else
  c_warn "No se encontró $NGINX_SSL_CONF"
fi

section "Resumen"
echo "  OK: $ok  WARN: $warn  FAIL: $fail"
[ "$fail" -eq 0 ] || exit 1
