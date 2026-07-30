#!/bin/bash
# Verifica en el VPS qué está configurado para dtunnel y qué falta.
# Uso (en el servidor):
#   cd /opt/dtunnel/server && bash verify-vps.sh
#   bash verify-vps.sh --domain dtunnel.desarrollado.com --user desarrollado
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- Config (override con flags o variables de entorno) ---
DTUNNEL_DOMAIN="${DTUNNEL_DOMAIN:-dtunnel.desarrollado.com}"
HESTIA_USER="${HESTIA_USER:-desarrollado}"
FRPS_VHOST_PORT="${FRPS_VHOST_PORT:-18080}"
FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
CONTAINER_NAME="${DTUNNEL_CONTAINER:-dtunnel_frps}"
HESTIA_TPL_DIR="${HESTIA_TPL_DIR:-/usr/local/hestia/data/templates/web/nginx}"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DTUNNEL_DOMAIN="$2"; shift 2 ;;
    --user)   HESTIA_USER="$2"; shift 2 ;;
    --help|-h)
      echo "Uso: $0 [--domain DOMINIO] [--user USUARIO_HESTIA]"
      exit 0
      ;;
    *) echo "Opción desconocida: $1"; exit 2 ;;
  esac
done

if [ -f .env ]; then
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
  FRPS_VHOST_PORT="${FRPS_VHOST_PORT:-18080}"
  FRPS_BIND_PORT="${FRPS_BIND_PORT:-7000}"
fi

DOMAIN_CONF="/home/${HESTIA_USER}/conf/web/${DTUNNEL_DOMAIN}"
NGINX_SSL_CONF="/etc/nginx/conf.d/domains/${DTUNNEL_DOMAIN}.ssl.conf"
NGINX_HTTP_CONF="/etc/nginx/conf.d/domains/${DTUNNEL_DOMAIN}.conf"
TEST_SUB="verify-$(date +%s).${DTUNNEL_DOMAIN}"

OK=0
WARN=0
FAIL=0
SKIP=0

c_ok()   { echo "  [OK]   $*"; OK=$((OK + 1)); }
c_warn() { echo "  [WARN] $*"; WARN=$((WARN + 1)); }
c_fail() { echo "  [FAIL] $*"; FAIL=$((FAIL + 1)); }
c_skip() { echo "  [SKIP] $*"; SKIP=$((SKIP + 1)); }

section() {
  echo ""
  echo "== $* =="
}

port_listening() {
  local port="$1"
  ss -tln 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" {found=1} END {exit !found}'
}

port_bind_addr() {
  local port="$1"
  ss -tln 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" {print $4}' | head -1
}

file_contains() {
  local file="$1"
  local pattern="$2"
  [ -f "$file" ] && grep -qE "$pattern" "$file" 2>/dev/null
}

# --- 1. Archivos locales del proyecto ---
section "Proyecto dtunnel ($SCRIPT_DIR)"

if [ -f .env ]; then
  c_ok "Archivo .env presente"
  if [ -n "${FRPS_TOKEN:-}" ] && [ "$FRPS_TOKEN" != "genera-un-token-largo-aleatorio" ]; then
    c_ok "FRPS_TOKEN definido (no es el placeholder)"
  else
    c_fail "FRPS_TOKEN vacío o placeholder — edita .env"
  fi
else
  c_fail "Falta .env — cp .env.example .env"
fi

if [ -f frps.runtime.toml ]; then
  c_ok "frps.runtime.toml generado"
  if file_contains frps.runtime.toml "vhostHTTPPort = ${FRPS_VHOST_PORT}"; then
    c_ok "vhostHTTPPort = ${FRPS_VHOST_PORT} en runtime"
  else
    c_warn "vhostHTTPPort en runtime no coincide con ${FRPS_VHOST_PORT} — ejecuta install.sh"
  fi
else
  c_warn "Falta frps.runtime.toml — ejecuta bash install.sh"
fi

if [ -f hestia/dtunnel.stpl ] && [ -f hestia/dtunnel.tpl ]; then
  c_ok "Plantillas hestia/ en el repo local"
else
  c_warn "Faltan plantillas en hestia/ del repo"
fi

# --- 2. Docker / frps ---
section "Docker y frps"

if command -v docker >/dev/null 2>&1; then
  c_ok "Docker instalado"
else
  c_fail "Docker no instalado"
fi

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"; then
  c_ok "Contenedor $CONTAINER_NAME en ejecución"
  status="$(docker inspect -f '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  [ "$status" = "running" ] || c_fail "Contenedor existe pero estado: ${status:-desconocido}"
else
  c_fail "Contenedor $CONTAINER_NAME no corre — bash install.sh"
fi

if port_listening "$FRPS_BIND_PORT"; then
  c_ok "Puerto ${FRPS_BIND_PORT} (control frpc) escuchando"
else
  c_fail "Puerto ${FRPS_BIND_PORT} no escucha — frps caído o mal configurado"
fi

if port_listening "$FRPS_VHOST_PORT"; then
  bind="$(port_bind_addr "$FRPS_VHOST_PORT")"
  c_ok "Puerto ${FRPS_VHOST_PORT} (vhost HTTP) escuchando en ${bind:-?}"
  if echo "${bind:-}" | grep -qE '^0\.0\.0\.0:|^\[::\]:|^\*$'; then
    c_warn "Puerto ${FRPS_VHOST_PORT} expuesto en todas las interfaces — idealmente solo 127.0.0.1 (network_mode: host de frp)"
  fi
else
  c_fail "Puerto ${FRPS_VHOST_PORT} no escucha — Nginx dará 502"
fi

if port_listening 8080; then
  c_ok "Puerto 8080 en uso (Apache Hestia — esperado)"
else
  c_skip "Puerto 8080 no detectado (puede variar según stack Hestia)"
fi

# --- 3. Plantillas Hestia ---
section "Plantillas Hestia (Nginx)"

for tpl in dtunnel.stpl dtunnel.tpl; do
  if [ -f "${HESTIA_TPL_DIR}/${tpl}" ]; then
    c_ok "Plantilla instalada: ${HESTIA_TPL_DIR}/${tpl}"
    if file_contains "${HESTIA_TPL_DIR}/${tpl}" "127\.0\.0\.1:${FRPS_VHOST_PORT}"; then
      c_ok "  → proxy_pass apunta a 127.0.0.1:${FRPS_VHOST_PORT}"
    else
      c_warn "  → proxy_pass no apunta a 127.0.0.1:${FRPS_VHOST_PORT}"
    fi
  else
    c_fail "Falta plantilla: ${HESTIA_TPL_DIR}/${tpl}"
  fi
done

# --- 4. Config generada del dominio ---
section "Dominio web: ${DTUNNEL_DOMAIN}"

if [ -d "$DOMAIN_CONF" ]; then
  c_ok "Directorio de config Hestia: $DOMAIN_CONF"
else
  c_fail "No existe $DOMAIN_CONF — revisa --user o dominio en Hestia"
fi

if [ -f "$NGINX_SSL_CONF" ]; then
  c_ok "Config Nginx SSL activa: $NGINX_SSL_CONF"
  if file_contains "$NGINX_SSL_CONF" "127\.0\.0\.1:${FRPS_VHOST_PORT}"; then
    c_ok "Nginx SSL hace proxy a 127.0.0.1:${FRPS_VHOST_PORT}"
  elif file_contains "$NGINX_SSL_CONF" "proxy_pass"; then
    c_warn "Nginx SSL tiene proxy_pass pero no a 127.0.0.1:${FRPS_VHOST_PORT}"
  else
    c_fail "Nginx SSL sin proxy a frps — asigna Plantilla Proxy: dtunnel y v-rebuild-web-domain"
  fi
  if file_contains "$NGINX_SSL_CONF" "@fallback|web_ssl_port|%web_ssl_port%"; then
    c_warn "Config SSL aún referencia fallback Apache — revisa plantilla dtunnel.stpl"
  fi
else
  c_fail "No existe $NGINX_SSL_CONF — dominio no reconstruido o SSL desactivado"
fi

if [ -f "$NGINX_HTTP_CONF" ]; then
  c_ok "Config Nginx HTTP: $NGINX_HTTP_CONF"
else
  c_skip "Sin config HTTP (puede ser normal si solo SSL)"
fi

if command -v v-list-web-domain >/dev/null 2>&1; then
  domain_json="$(v-list-web-domain "$HESTIA_USER" "$DTUNNEL_DOMAIN" json 2>/dev/null || true)"
  if [ -n "$domain_json" ]; then
    c_ok "Dominio registrado en Hestia (v-list-web-domain)"
    if echo "$domain_json" | grep -q '"PROXY"' || echo "$domain_json" | grep -qi 'dtunnel'; then
      proxy_tpl="$(echo "$domain_json" | grep -oE '"PROXY":"[^"]*"' | head -1 || true)"
      if echo "$proxy_tpl" | grep -q dtunnel; then
        c_ok "Plantilla proxy asignada: dtunnel"
      elif [ -n "$proxy_tpl" ]; then
        c_warn "Plantilla proxy: $proxy_tpl (se esperaba dtunnel)"
      fi
    fi
  fi
else
  c_skip "v-list-web-domain no disponible (¿no es Hestia o sin PATH?)"
fi

# --- 5. Nginx sintaxis ---
section "Nginx"

if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    c_ok "nginx -t OK"
  else
    c_fail "nginx -t falló — revisa sintaxis"
    nginx -t 2>&1 | sed 's/^/         /' || true
  fi
else
  c_skip "nginx no en PATH"
fi

# --- 6. DNS ---
section "DNS"

resolve_ip() {
  local host="$1"
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$host" 2>/dev/null | awk '/STREAM/ {print $1; exit}'
  elif command -v dig >/dev/null 2>&1; then
    dig +short A "$host" 2>/dev/null | head -1
  else
    host -t A "$host" 2>/dev/null | awk '/address/ {print $NF; exit}'
  fi
}

SERVER_IP="$(resolve_ip "$(hostname -f 2>/dev/null || hostname)" || true)"
[ -z "$SERVER_IP" ] && SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

for host in "$DTUNNEL_DOMAIN" "$TEST_SUB"; do
  ip="$(resolve_ip "$host" || true)"
  if [ -n "$ip" ]; then
    if [ -n "$SERVER_IP" ] && [ "$ip" = "$SERVER_IP" ]; then
      c_ok "DNS $host → $ip (este servidor)"
    else
      c_warn "DNS $host → ${ip:-?} (servidor local: ${SERVER_IP:-desconocido})"
    fi
  else
    c_fail "DNS no resuelve: $host"
  fi
done

# --- 7. HTTPS / SSL ---
section "HTTPS y certificado"

if command -v curl >/dev/null 2>&1; then
  http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "https://${DTUNNEL_DOMAIN}/" 2>/dev/null || echo "000")"
  case "$http_code" in
    000) c_fail "curl HTTPS falló — sin respuesta o cert inválido" ;;
    502) c_fail "HTTPS responde 502 — Nginx no llega a frps :${FRPS_VHOST_PORT}" ;;
    404) c_ok "HTTPS responde ${http_code} (frp sin túnel activo — normal)" ;;
    200|301|302|307|401|403) c_ok "HTTPS responde ${http_code}" ;;
    *) c_warn "HTTPS responde ${http_code} — revisar manualmente" ;;
  esac

  if echo | openssl s_client -connect "${DTUNNEL_DOMAIN}:443" -servername "$DTUNNEL_DOMAIN" 2>/dev/null \
      | openssl x509 -noout -dates -subject 2>/dev/null | grep -q "notAfter"; then
    c_ok "Certificado TLS válido para ${DTUNNEL_DOMAIN}"
    sans="$(echo | openssl s_client -connect "${DTUNNEL_DOMAIN}:443" -servername "$DTUNNEL_DOMAIN" 2>/dev/null \
      | openssl x509 -noout -text 2>/dev/null | grep -A1 'Subject Alternative Name' | tail -1 || true)"
    if echo "$sans" | grep -q '\*'; then
      c_ok "Cert incluye wildcard en SAN"
    else
      c_warn "Cert puede no incluir wildcard — revisa alias en Hestia"
    fi
  else
    c_warn "No se pudo leer certificado TLS (openssl)"
  fi
else
  c_skip "curl no instalado — omitiendo prueba HTTPS"
fi

# --- 8. API ---
section "API (puerto 3001)"

if port_listening 3001; then
  c_ok "API escuchando en 3001"
else
  c_fail "API no escucha en 3001 — docker compose en /opt/dtunnel/api"
fi

if command -v curl >/dev/null 2>&1; then
  api_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "https://${DTUNNEL_DOMAIN}/api/health" 2>/dev/null || echo "000")"
  if [ "$api_code" = "200" ]; then
    c_ok "GET /api/health → 200"
  else
    c_warn "GET /api/health → ${api_code}"
  fi
fi

# --- 9. Firewall puerto 7000 ---
section "Firewall (puerto ${FRPS_BIND_PORT})"

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  if ufw status 2>/dev/null | grep -qE "${FRPS_BIND_PORT}/tcp.*ALLOW"; then
    c_ok "UFW permite TCP ${FRPS_BIND_PORT}"
  else
    c_warn "UFW activo pero no se ve regla para ${FRPS_BIND_PORT}/tcp — clientes frpc no conectarán"
  fi
else
  c_skip "UFW inactivo o no instalado — comprueba firewall Contabo/panel manualmente"
fi

if timeout 2 bash -c "echo >/dev/tcp/127.0.0.1/${FRPS_BIND_PORT}" 2>/dev/null; then
  c_ok "TCP local ${FRPS_BIND_PORT} acepta conexiones"
else
  c_fail "TCP local ${FRPS_BIND_PORT} no acepta conexiones"
fi

# --- Resumen ---
section "Resumen"

TOTAL=$((OK + WARN + FAIL + SKIP))
echo "  OK: ${OK}  |  WARN: ${WARN}  |  FAIL: ${FAIL}  |  SKIP: ${SKIP}  (total checks: ${TOTAL})"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Hay ${FAIL} problema(s) crítico(s). Revisa [FAIL] arriba."
  echo "Docs: docs/hestia.md"
  exit 1
fi

if [ "$WARN" -gt 0 ]; then
  echo "Configuración usable con advertencias. Revisa [WARN]."
  exit 0
fi

echo "Todo lo verificado está OK. Prueba un túnel desde tu PC:"
echo "  dtunnel --port 88080"
exit 0
