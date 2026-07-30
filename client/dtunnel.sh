#!/usr/bin/env bash
# dtunnel CLI (bash) — sin Node. Usado por el instalador curl.
# También disponible vía: npm install -g @desarrollado/dtunnel
set -euo pipefail

DTUNNEL_API_URL="${DTUNNEL_API_URL:-https://dtunnel.desarrollado.com/api}"
CONFIG_DIR="${HOME}/.dtunnel"
CONFIG_FILE="${CONFIG_DIR}/config.json"
PID_FILE="${CONFIG_DIR}/frpc.pid"
FRPC_CONF="${CONFIG_DIR}/frpc.toml"

usage() {
  cat <<EOF
dtunnel — URL pública para tu servidor local

  dtunnel --port <puerto>              Túnel con subdominio aleatorio
  dtunnel --port <puerto> -s <nombre>  Túnel con subdominio reservado
  dtunnel login                        Iniciar sesión
  dtunnel register                     Crear cuenta
  dtunnel reserve <nombre>             Reservar subdominio (requiere login)
  dtunnel down                         Detener túnel

Variables:
  DTUNNEL_API_URL   ${DTUNNEL_API_URL}
EOF
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: falta '$1' en PATH"; exit 1; }
}

json_get() {
  # json_get '<json>' 'key'  → valor string (requiere python3)
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d[sys.argv[2]])" "$1" "$2" 2>/dev/null
}

api_post() {
  local path="$1"
  local body="$2"
  local auth="${3:-}"
  local tmp
  tmp="$(mktemp)"
  local code
  if [ -n "$auth" ]; then
    code=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer ${auth}" \
      -d "$body" "${DTUNNEL_API_URL}${path}")
  else
    code=$(curl -sS -o "$tmp" -w '%{http_code}' -X POST \
      -H "Content-Type: application/json" \
      -d "$body" "${DTUNNEL_API_URL}${path}")
  fi
  if [ "$code" -ge 400 ]; then
    local err
    err="$(json_get "$(cat "$tmp")" error 2>/dev/null || cat "$tmp")"
    rm -f "$tmp"
    echo "ERROR: ${err:-HTTP $code}" >&2
    exit 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

load_token() {
  [ -f "$CONFIG_FILE" ] || return 0
  python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('token',''))" 2>/dev/null || true
}

save_session() {
  local email="$1" token="$2"
  mkdir -p "$CONFIG_DIR"
  DTUNNEL_EMAIL="$email" DTUNNEL_TOKEN="$token" DTUNNEL_CFG="$CONFIG_FILE" python3 -c "
import json, os
json.dump(
    {'email': os.environ['DTUNNEL_EMAIL'], 'token': os.environ['DTUNNEL_TOKEN']},
    open(os.environ['DTUNNEL_CFG'], 'w'),
    indent=2,
)
"
}

write_frpc_toml() {
  local server="$1" server_port="$2" token="$3" subdomain="$4" port="$5"
  mkdir -p "$CONFIG_DIR"
  python3 <<PY
token = """${token}"""
subdomain = """${subdomain}"""
content = f'''serverAddr = "{server}"
serverPort = {server_port}

auth.method = "token"
auth.token = {token!r}

[[proxies]]
name = "{subdomain}"
type = "http"
localIP = "127.0.0.1"
localPort = {port}
subdomain = "{subdomain}"
'''
open("${FRPC_CONF}", "w").write(content)
PY
}

cmd_login() {
  require_cmd curl
  read -r -p "Email: " email
  read -r -s -p "Contraseña: " password
  echo ""
  local resp
  resp="$(api_post "/auth/login" "{\"email\":\"${email}\",\"password\":\"${password}\"}")"
  local token
  token="$(json_get "$resp" token)"
  save_session "$email" "$token"
  echo "Sesión iniciada como ${email}"
}

cmd_register() {
  require_cmd curl
  read -r -p "Email: " email
  read -r -s -p "Contraseña (mín. 8): " password
  echo ""
  local resp
  resp="$(api_post "/auth/register" "{\"email\":\"${email}\",\"password\":\"${password}\"}")"
  local token
  token="$(json_get "$resp" token)"
  save_session "$email" "$token"
  echo "Cuenta creada: ${email}"
}

cmd_reserve() {
  local name="${1:-}"
  [ -n "$name" ] || { echo "Uso: dtunnel reserve <nombre>"; exit 1; }
  local token
  token="$(load_token)"
  [ -n "$token" ] || { echo "ERROR: ejecuta dtunnel login primero"; exit 1; }
  local resp
  resp="$(api_post "/subdomains/reserve" "{\"name\":\"${name}\"}" "$token")"
  echo "Reservado: $(json_get "$resp" url)"
}

cmd_up() {
  local port="${1:-}" subdomain="${2:-}"
  [ -n "$port" ] || { usage; exit 1; }
  require_cmd curl
  require_cmd frpc

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Ya hay un túnel activo. Ejecuta: dtunnel down"
    exit 1
  fi

  local body="{\"port\":${port}"
  [ -n "$subdomain" ] && body="${body},\"subdomain\":\"${subdomain}\""
  body="${body}}"

  local token
  token="$(load_token)"
  local resp
  if [ -n "$token" ]; then
    resp="$(api_post "/tunnels" "$body" "$token")"
  else
    resp="$(api_post "/tunnels" "$body")"
  fi

  local server server_port frp_token sub http_url https_url
  server="$(json_get "$resp" server)"
  server_port="$(json_get "$resp" serverPort)"
  frp_token="$(json_get "$resp" token)"
  sub="$(json_get "$resp" subdomain)"
  http_url="$(json_get "$resp" httpUrl)"
  https_url="$(json_get "$resp" httpsUrl)"

  write_frpc_toml "$server" "$server_port" "$frp_token" "$sub" "$port"
  frpc -c "$FRPC_CONF" >/dev/null 2>&1 &
  echo $! > "$PID_FILE"
  sleep 1

  echo ""
  echo "${http_url}  ⟶  http://localhost:${port}"
  echo "${https_url}  ⟶  http://localhost:${port}"
  echo ""
  echo "Usa: dtunnel down"
}

cmd_down() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  rm -f "$FRPC_CONF"
  echo "Túnel detenido"
}

# --- main ---
CMD="up"
PORT=""
SUBDOMAIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p) PORT="$2"; shift 2 ;;
    --subdomain|-s) SUBDOMAIN="$2"; shift 2 ;;
    login) CMD="login"; shift ;;
    register) CMD="register"; shift ;;
    reserve) CMD="reserve"; SUBDOMAIN="$2"; shift 2 ;;
    down|stop) CMD="down"; shift ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]] && [ -z "$PORT" ]; then PORT="$1"; shift
      else echo "Opción desconocida: $1"; usage; exit 1; fi
      ;;
  esac
done

case "$CMD" in
  login) cmd_login ;;
  register) cmd_register ;;
  reserve) cmd_reserve "$SUBDOMAIN" ;;
  down) cmd_down ;;
  up) cmd_up "$PORT" "$SUBDOMAIN" ;;
esac
