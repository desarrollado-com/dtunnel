#!/usr/bin/env bash
# dtunnel CLI (bash) — sin Node. Usado por el instalador curl.
# También disponible vía: npm install -g @desarrollado/dtunnel
set -euo pipefail

DTUNNEL_CLI_VERSION="1.0.2"
DTUNNEL_API_URL="${DTUNNEL_API_URL:-https://dtunnel.desarrollado.com/api}"
CONFIG_DIR="${HOME}/.dtunnel"
CONFIG_FILE="${CONFIG_DIR}/config.json"
PID_FILE="${CONFIG_DIR}/frpc.pid"
STATE_FILE="${CONFIG_DIR}/tunnel.json"
FRPC_CONF="${CONFIG_DIR}/frpc.toml"

usage() {
  cat <<EOF
dtunnel — URL pública para tu servidor local

  dtunnel --port <puerto>              Túnel con subdominio aleatorio
  dtunnel --port <puerto> -s <nombre>  Túnel con subdominio reservado
  dtunnel status                       Estado del túnel local
  dtunnel --list up                    Listar túneles activos
  dtunnel version                      Versión instalada
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

api_get() {
  local path="$1"
  local auth="${2:-}"
  local tmp code
  tmp="$(mktemp)"
  if [ -n "$auth" ]; then
    code=$(curl -sS -o "$tmp" -w '%{http_code}' \
      -H "Authorization: Bearer ${auth}" \
      "${DTUNNEL_API_URL}${path}")
  else
    code=$(curl -sS -o "$tmp" -w '%{http_code}' "${DTUNNEL_API_URL}${path}")
  fi
  if [ "$code" -ge 400 ]; then
    local err
    err="$(json_get "$(cat "$tmp")" error 2>/dev/null || cat "$tmp")"
    rm -f "$tmp"
    echo "ERROR: ${err:-HTTP $code}" >&2
    return 1
  fi
  cat "$tmp"
  rm -f "$tmp"
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
cfg = {}
if os.path.exists(os.environ['DTUNNEL_CFG']):
    try:
        cfg = json.load(open(os.environ['DTUNNEL_CFG']))
    except Exception:
        cfg = {}
cfg['email'] = os.environ['DTUNNEL_EMAIL']
cfg['token'] = os.environ['DTUNNEL_TOKEN']
json.dump(cfg, open(os.environ['DTUNNEL_CFG'], 'w'), indent=2)
"
}

load_email() {
  [ -f "$CONFIG_FILE" ] || return 0
  python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('email',''))" 2>/dev/null || true
}

is_pid_running() {
  local pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

save_tunnel_state() {
  local pid="$1" subdomain="$2" port="$3" http_url="$4" https_url="$5"
  mkdir -p "$CONFIG_DIR"
  DTUNNEL_PID="$pid" DTUNNEL_SUB="$subdomain" DTUNNEL_PORT="$port" \
  DTUNNEL_HTTP="$http_url" DTUNNEL_HTTPS="$https_url" DTUNNEL_STATE="$STATE_FILE" python3 -c "
import json, os
from datetime import datetime, timezone
json.dump({
    'pid': int(os.environ['DTUNNEL_PID']),
    'subdomain': os.environ['DTUNNEL_SUB'],
    'port': int(os.environ['DTUNNEL_PORT']),
    'httpUrl': os.environ['DTUNNEL_HTTP'],
    'httpsUrl': os.environ['DTUNNEL_HTTPS'],
    'startedAt': datetime.now(timezone.utc).isoformat(),
}, open(os.environ['DTUNNEL_STATE'], 'w'), indent=2)
"
}

get_local_tunnel_pid() {
  if [ -f "$STATE_FILE" ]; then
    python3 -c "import json; print(json.load(open('$STATE_FILE')).get('pid',''))" 2>/dev/null || true
    return
  fi
  if [ -f "$PID_FILE" ]; then cat "$PID_FILE"; fi
}

clear_tunnel_state() {
  rm -f "$STATE_FILE" "$PID_FILE" "$FRPC_CONF"
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
  local stale_pid
  stale_pid="$(get_local_tunnel_pid)"
  if [ -n "$stale_pid" ] && is_pid_running "$stale_pid"; then
    echo "Ya hay un túnel activo. Ejecuta: dtunnel down"
    exit 1
  fi
  clear_tunnel_state

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
  save_tunnel_state "$!" "$sub" "$port" "$http_url" "$https_url"
  sleep 1

  echo ""
  echo "${http_url}  ⟶  http://localhost:${port}"
  echo "${https_url}  ⟶  http://localhost:${port}"
  echo ""
  echo "Usa: dtunnel down"
}

cmd_down() {
  local pid
  pid="$(get_local_tunnel_pid)"
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
  elif [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
  fi
  clear_tunnel_state
  echo "Túnel detenido"
}

cmd_version() {
  echo "dtunnel ${DTUNNEL_CLI_VERSION}"
}

cmd_status() {
  local pid email
  pid="$(get_local_tunnel_pid)"
  email="$(load_email)"

  if [ -z "$pid" ] || ! is_pid_running "$pid"; then
    clear_tunnel_state
    echo "Sin túnel activo en esta máquina."
    [ -n "$email" ] && echo "Sesión: ${email}"
    return
  fi

  if [ ! -f "$STATE_FILE" ]; then
    echo "Túnel activo"
    echo "  PID frpc:   ${pid}"
    [ -n "$email" ] && echo "  Sesión:     ${email}"
    return
  fi

  python3 <<PY
import json
state = json.load(open("${STATE_FILE}"))
email = """${email}"""
print("Túnel activo")
print(f"  Subdominio: {state.get('subdomain', '-')}")
print(f"  Puerto:     localhost:{state.get('port', '-')}")
if state.get('httpUrl'):
    print(f"  HTTP:       {state['httpUrl']}")
if state.get('httpsUrl'):
    print(f"  HTTPS:      {state['httpsUrl']}")
print(f"  PID frpc:   {state.get('pid', '${pid}')}")
if state.get('startedAt'):
    print(f"  Desde:      {state['startedAt']}")
if email:
    print(f"  Sesión:     {email}")
PY
}

cmd_list() {
  local what="${1:-}"
  if [ "$what" != "up" ]; then
    echo "Uso: dtunnel --list up"
    exit 1
  fi

  require_cmd curl
  local pid token email resp
  pid="$(get_local_tunnel_pid)"
  token="$(load_token)"
  email="$(load_email)"
  local has_local=0 has_remote=0

  if [ -n "$pid" ] && is_pid_running "$pid" && [ -f "$STATE_FILE" ]; then
    has_local=1
    echo "LOCAL"
    python3 <<PY
import json
s = json.load(open("${STATE_FILE}"))
print(f"  {s.get('subdomain','?'):<16} localhost:{s.get('port','?')}  {s.get('httpsUrl','')}")
PY
  elif [ -n "$pid" ] && ! is_pid_running "$pid"; then
    clear_tunnel_state
  fi

  if [ -n "$token" ]; then
    resp="$(api_get "/tunnels" "$token" 2>/dev/null || true)"
    if [ -n "$resp" ]; then
      DTUNNEL_RESP="$resp" DTUNNEL_LOCAL="$STATE_FILE" python3 <<'PY'
import json, os
resp = json.loads(os.environ['DTUNNEL_RESP'])
tunnels = resp.get('tunnels', [])
if not tunnels:
    raise SystemExit(0)
local_sub = None
if os.path.exists(os.environ['DTUNNEL_LOCAL']):
    try:
        local_sub = json.load(open(os.environ['DTUNNEL_LOCAL'])).get('subdomain')
    except Exception:
        pass
print('\nCUENTA' if local_sub is not None else 'CUENTA')
for t in tunnels:
    marker = '*' if t.get('subdomain') == local_sub else ' '
    print(f"{marker} {t.get('subdomain','?'):<16} localhost:{t.get('port','?')}  {t.get('httpsUrl','')}")
if local_sub is not None:
    print('\n* = también activo en esta máquina')
PY
      has_remote=1
    else
      echo "No se pudo consultar la cuenta." >&2
    fi
  fi

  if [ "$has_local" -eq 0 ] && [ "$has_remote" -eq 0 ]; then
    echo "No hay túneles activos."
    [ -z "$token" ] && echo "Inicia sesión con dtunnel login para ver túneles de tu cuenta."
  fi
}

# --- main ---
CMD="up"
PORT=""
SUBDOMAIN=""
LIST_WHAT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p) PORT="$2"; shift 2 ;;
    --subdomain|-s) SUBDOMAIN="$2"; shift 2 ;;
    --list) CMD="list"; LIST_WHAT="$2"; shift 2 ;;
    login) CMD="login"; shift ;;
    register) CMD="register"; shift ;;
    reserve) CMD="reserve"; SUBDOMAIN="$2"; shift 2 ;;
    status) CMD="status"; shift ;;
    version|-v|--version) CMD="version"; shift ;;
    list)
      CMD="list"
      shift
      LIST_WHAT="${1:-up}"
      [ $# -gt 0 ] && shift
      ;;
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
  status) cmd_status ;;
  version) cmd_version ;;
  list) cmd_list "$LIST_WHAT" ;;
  up) cmd_up "$PORT" "$SUBDOMAIN" ;;
esac
