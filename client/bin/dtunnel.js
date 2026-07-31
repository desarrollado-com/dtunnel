#!/usr/bin/env node
/**
 * dtunnel CLI — expone localhost como URL pública (túnel nativo Node.js + WebSocket)
 */
import { spawn } from 'child_process';
import { createConnection } from 'net';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = PKG.version;
const CONFIG_DIR = join(homedir(), '.dtunnel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PID_FILE = join(CONFIG_DIR, 'tunnel.pid');
const STATE_FILE = join(CONFIG_DIR, 'tunnel.json');
const HEARTBEAT_PID_FILE = join(CONFIG_DIR, 'heartbeat.pid');

function readPid() {
  if (!existsSync(PID_FILE)) return null;
  return Number(readFileSync(PID_FILE, 'utf8'));
}

const DEFAULT_API = 'https://dtunnel.desarrollado.com/api';
const DEFAULT_DOMAIN = 'dtunnel.desarrollado.com';
const DEFAULT_LOCAL_HOST = '127.0.0.1';

function resolveLocalHost(args, cfg = loadConfig()) {
  return process.env.DTUNNEL_LOCAL_HOST || args.host || cfg.localHost || DEFAULT_LOCAL_HOST;
}

function formatLocalTarget(host, port) {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]:${port}`;
  }
  return `${host}:${port}`;
}

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadTunnelState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveTunnelState(state) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function clearTunnelState() {
  if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE);
}

function stopHeartbeat() {
  if (!existsSync(HEARTBEAT_PID_FILE)) return;
  const pid = Number(readFileSync(HEARTBEAT_PID_FILE, 'utf8'));
  try { unlinkSync(HEARTBEAT_PID_FILE); } catch { /* ignore */ }
  try { process.kill(pid); } catch { /* ignore */ }
}

function startHeartbeat() {
  stopHeartbeat();
  const hbScript = join(__dirname, 'tunnel-heartbeat.js');
  const child = spawn(process.execPath, [hbScript], {
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.on('error', () => { /* ignore */ });
  child.unref();
  if (child.pid) writeFileSync(HEARTBEAT_PID_FILE, String(child.pid));
}

function probeLocalPort(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}

function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function getLocalTunnel() {
  const state = loadTunnelState();
  const pid = state?.pid ?? readPid();
  if (!isPidRunning(pid)) {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    return null;
  }
  return { ...state, pid, running: true };
}

function getStaleTunnelState() {
  if (getLocalTunnel()) return null;
  return loadTunnelState();
}

async function releaseTunnelRemote(subdomain) {
  if (!subdomain) return;
  const cfg = loadConfig();
  const base = process.env.DTUNNEL_API_URL || cfg.apiUrl || DEFAULT_API;
  const headers = { ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) };
  const res = await fetch(`${base}/tunnels/${encodeURIComponent(subdomain)}`, {
    method: 'DELETE',
    headers,
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

async function reclaimAnonymousSlot() {
  const cfg = loadConfig();
  if (cfg.token) return false;
  const base = process.env.DTUNNEL_API_URL || cfg.apiUrl || DEFAULT_API;
  try {
    const res = await fetch(`${base}/tunnels/anonymous`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

async function releaseStaleTunnel() {
  const stale = getStaleTunnelState();
  if (!stale?.subdomain) return;
  try {
    await releaseTunnelRemote(stale.subdomain);
  } catch {
    /* ignore */
  }
  clearTunnelState();
}

function parseArgs(argv) {
  const args = { port: null, subdomain: null, host: null, cmd: 'up', listWhat: null, follow: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--subdomain' || a === '-s') args.subdomain = argv[++i];
    else if (a === '--host' || a === '-H') args.host = argv[++i];
    else if (a === '--follow' || a === '-f') args.follow = true;
    else if (a === '--list') { args.cmd = 'list'; args.listWhat = argv[++i]; }
    else if (a === 'login') args.cmd = 'login';
    else if (a === 'down' || a === 'stop') args.cmd = 'down';
    else if (a === 'register') args.cmd = 'register';
    else if (a === 'status') args.cmd = 'status';
    else if (a === 'logs') args.cmd = 'logs';
    else if (a === 'version' || a === '-v' || a === '--version') args.cmd = 'version';
    else if (a === 'list') { args.cmd = 'list'; args.listWhat = argv[++i] || 'up'; }
    else if (a === 'reserve') { args.cmd = 'reserve'; args.subdomain = argv[++i]; }
    else if (a === 'config') args.cmd = 'config';
    else if (a === '--help' || a === '-h' || a === 'help') args.cmd = 'help';
    else if (!a.startsWith('-') && !args.port) args.port = Number(a);
  }
  return args;
}

function usage() {
  console.log(`
dtunnel — URL pública para tu servidor local

  dtunnel --port <puerto>              Túnel con subdominio aleatorio
  dtunnel --port <puerto> -s <nombre>  Túnel con subdominio reservado
  dtunnel --port 3000 --host mi-proyecto   Destino Docker / hostname local
  dtunnel status                       Estado del túnel local
  dtunnel logs [--follow] [-s nombre]  Trazas HTTP de tus túneles
  dtunnel --list up                    Listar túneles activos
  dtunnel version                      Versión instalada
  dtunnel login                        Iniciar sesión
  dtunnel register                     Crear cuenta
  dtunnel reserve <nombre>             Reservar subdominio (requiere login)
  dtunnel config                       Ver configuración local
  dtunnel config set localHost <host>  Host por defecto (p. ej. mi-proyecto)
  dtunnel down                         Detener túnel

Variables:
  DTUNNEL_API_URL     ${DEFAULT_API}
  DTUNNEL_LOCAL_HOST  ${DEFAULT_LOCAL_HOST} (o nombre Docker, p. ej. mi-proyecto)

Archivo ~/.dtunnel/config.json:
  localHost, apiUrl, token, email, clientId
`);
}

function cmdConfig(argv) {
  const sub = argv[3];
  const cfg = loadConfig();
  if (sub === 'set' && argv[4] && argv[5] !== undefined) {
    const key = argv[4];
    const value = argv[5];
    if (!['localHost', 'apiUrl'].includes(key)) {
      console.error('Claves permitidas: localHost, apiUrl');
      return 1;
    }
    cfg[key] = value;
    saveConfig(cfg);
    console.log(`OK: ${key} = ${value}`);
    return 0;
  }
  const display = { ...cfg };
  if (display.token) display.token = '***';
  if (!display.localHost) display.localHost = DEFAULT_LOCAL_HOST;
  console.log(JSON.stringify(display, null, 2));
  return 0;
}

function formatTraceLine(t) {
  const when = t.createdAt ? new Date(t.createdAt.includes('T') ? t.createdAt : `${t.createdAt}Z`).toLocaleTimeString() : '—';
  const status = t.status != null ? String(t.status).padStart(3) : ' — ';
  const ms = t.durationMs != null ? `${String(t.durationMs).padStart(4)}ms` : '   — ';
  const sub = (t.subdomain || '').padEnd(14);
  return `${when}  ${status}  ${ms}  ${sub}  ${t.method} ${t.path}`;
}

async function cmdLogs(args) {
  const cfg = loadConfig();
  if (!cfg.token) {
    console.error('Requiere sesión: dtunnel login');
    return 1;
  }
  const base = process.env.DTUNNEL_API_URL || cfg.apiUrl || DEFAULT_API;
  const subdomain = args.subdomain || null;

  if (args.follow) {
    let url = `${base.replace(/^http/, 'ws')}/request-logs/ws?token=${encodeURIComponent(cfg.token)}`;
    if (subdomain) url += `&subdomain=${encodeURIComponent(subdomain)}`;
    console.log(subdomain ? `Siguiendo trazas de ${subdomain}…` : 'Siguiendo trazas de tus túneles…');
    console.log('(Ctrl+C para salir)\n');
    return new Promise((resolve) => {
      const ws = new WebSocket(url);
      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(String(raw)); } catch { return; }
        if (msg.type === 'history' && Array.isArray(msg.traces)) {
          for (const t of [...msg.traces].reverse()) console.log(formatTraceLine(t));
        } else if (msg.type === 'trace' && msg.trace) {
          console.log(formatTraceLine(msg.trace));
        }
      });
      ws.on('error', (err) => {
        console.error(`WebSocket: ${err.message}`);
        resolve(1);
      });
      ws.on('close', (code, reason) => {
        if (code !== 1000) console.error(`Desconectado (${code}${reason ? `: ${reason}` : ''})`);
        resolve(code === 1000 ? 0 : 1);
      });
    });
  }

  const params = new URLSearchParams({ limit: '50' });
  if (subdomain) params.set('subdomain', subdomain);
  const data = await apiFetch(`/request-logs?${params}`);
  if (!data.traces?.length) {
    console.log('Sin trazas recientes.');
    return 0;
  }
  for (const t of data.traces) console.log(formatTraceLine(t));
  return 0;
}

async function apiFetch(path, options = {}) {
  const cfg = loadConfig();
  const base = process.env.DTUNNEL_API_URL || cfg.apiUrl || DEFAULT_API;
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': `dtunnel-cli/${VERSION}`,
    'X-Dtunnel-Version': VERSION,
    ...(options.headers || {}),
  };
  if (!cfg.clientId) {
    cfg.clientId = `dt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    saveConfig(cfg);
  }
  headers['X-Dtunnel-Client'] = cfg.clientId;
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`${base}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    if (body.code) err.code = body.code;
    throw err;
  }
  return body;
}

async function prompt(question) {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

async function cmdLogin() {
  const email = await prompt('Email: ');
  const password = await prompt('Contraseña: ');
  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const cfg = loadConfig();
    cfg.token = data.token;
    cfg.email = data.email;
    saveConfig(cfg);
    console.log(`Sesión iniciada como ${data.email}`);
  } catch (err) {
    if (err.code === 'EMAIL_NOT_VERIFIED') {
      console.error('Debes verificar tu email antes de iniciar sesión.');
      console.error('Revisa tu bandeja de entrada o visita: https://dtunnel.desarrollado.com/verify-pending.html');
      return 1;
    }
    throw err;
  }
}

async function cmdRegister() {
  const email = await prompt('Email: ');
  const password = await prompt('Contraseña (mín. 8): ');
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!data.emailVerified) {
    console.log(`Cuenta creada: ${data.email}`);
    console.log('Revisa tu email para activar la cuenta antes de usar dtunnel login.');
    console.log('Reenvío: https://dtunnel.desarrollado.com/verify-pending.html');
    return 0;
  }
  const cfg = loadConfig();
  cfg.token = data.token;
  cfg.email = data.email;
  saveConfig(cfg);
  console.log(`Cuenta creada y verificada: ${data.email}`);
}

async function cmdReserve(name) {
  if (!name) { console.error('Uso: dtunnel reserve <nombre>'); return 1; }
  const data = await apiFetch('/subdomains/reserve', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  console.log(`Reservado: ${data.url}`);
}

async function startTunnelClient(data, args) {
  const localHost = resolveLocalHost(args);
  const target = formatLocalTarget(localHost, args.port);
  const script = join(__dirname, 'native-client.js');
  const child = spawn(process.execPath, [
    script,
    '--ws-url', data.wsUrl,
    '--token', data.tunnelToken,
    '--host', localHost,
    '--port', String(args.port),
    '--subdomain', data.subdomain,
  ], { stdio: 'ignore', detached: true });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  saveTunnelState({
    pid: child.pid,
    tunnelId: data.tunnelId,
    subdomain: data.subdomain,
    port: args.port,
    localHost,
    httpUrl: data.httpUrl,
    httpsUrl: data.httpsUrl,
    host: data.host || `${data.subdomain}.${DEFAULT_DOMAIN}`,
    startedAt: new Date().toISOString(),
  });
  startHeartbeat();
  console.log('');
  console.log(`${data.httpUrl}  ⟶  http://${target}`);
  console.log(`${data.httpsUrl}  ⟶  http://${target}`);
  console.log('');
  console.log('Túnel activo. Ctrl+C no detiene el túnel. Usa: dtunnel down');
}

async function cmdUp(args) {
  if (!args.port) { usage(); return 1; }

  await releaseStaleTunnel();

  const body = { port: args.port };
  if (args.subdomain) body.subdomain = args.subdomain;

  let data;
  try {
    data = await apiFetch('/tunnels', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (String(err.message).includes('Límite de túneles') && !loadConfig().token) {
      if (await reclaimAnonymousSlot()) {
        data = await apiFetch('/tunnels', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else {
        console.error(err.message);
        console.error('Ejecuta: dtunnel down');
        return 1;
      }
    } else if (String(err.message).includes('Límite de túneles')) {
      console.error(err.message);
      console.error('Ejecuta: dtunnel down');
      return 1;
    } else if (String(err.message).includes('Subdominio en uso')) {
      console.error(err.message);
      if (args.subdomain) {
        console.error(`Prueba: dtunnel down && dtunnel --port ${args.port} -s ${args.subdomain}`);
      }
      return 1;
    } else if (String(err.message).includes('Subdominio no reservado')) {
      console.error(err.message);
      if (args.subdomain) console.error(`Reserva primero: dtunnel reserve ${args.subdomain}`);
      return 1;
    } else if (String(err.message).includes('Inicia sesión')) {
      console.error(err.message);
      console.error('Ejecuta: dtunnel login');
      return 1;
    } else {
      throw err;
    }
  }

  if (getLocalTunnel()) {
    console.error('Ya hay un túnel activo. Ejecuta: dtunnel down');
    return 1;
  }

  if (!data.wsUrl || !data.tunnelToken) {
    console.error('El servidor no devolvió credenciales de túnel. Actualiza la API o contacta soporte.');
    return 1;
  }

  const localHost = resolveLocalHost(args);
  const target = formatLocalTarget(localHost, args.port);
  const reachable = await probeLocalPort(localHost, args.port);
  if (!reachable) {
    console.warn('');
    console.warn(`Aviso: no hay nada escuchando en http://${target}`);
    console.warn('El túnel arrancará, pero las peticiones devolverán 502 hasta que el servidor local esté activo.');
    console.warn('');
  }

  await startTunnelClient(data, args);
  return 0;
}

async function cmdDown() {
  stopHeartbeat();
  const state = loadTunnelState();
  const local = getLocalTunnel();

  if (local?.pid) {
    try { process.kill(local.pid); } catch { /* ignore */ }
  } else {
    const pid = readPid();
    if (pid) try { process.kill(pid); } catch { /* ignore */ }
  }

  if (state?.subdomain) {
    try {
      await releaseTunnelRemote(state.subdomain);
    } catch (err) {
      console.warn(`No se pudo liberar en el servidor: ${err.message}`);
    }
  } else if (!loadConfig().token) {
    try {
      await reclaimAnonymousSlot();
    } catch { /* ignore */ }
  }

  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  clearTunnelState();
  console.log('Túnel detenido');
}

function cmdStatus() {
  const cfg = loadConfig();
  const local = getLocalTunnel();

  if (!local) {
    console.log('Sin túnel activo en esta máquina.');
    if (cfg.email) console.log(`Sesión: ${cfg.email}`);
    return;
  }

  console.log('Túnel activo');
  console.log(`  Subdominio: ${local.subdomain}`);
  console.log(`  Host:       ${local.host || `${local.subdomain}.${DEFAULT_DOMAIN}`}`);
  console.log(`  Destino:    http://${formatLocalTarget(local.localHost || DEFAULT_LOCAL_HOST, local.port)}`);
  if (local.httpUrl) console.log(`  HTTP:       ${local.httpUrl}`);
  if (local.httpsUrl) console.log(`  HTTPS:      ${local.httpsUrl}`);
  console.log(`  PID:        ${local.pid}`);
  if (local.startedAt) console.log(`  Desde:      ${local.startedAt}`);
  if (cfg.email) console.log(`  Sesión:     ${cfg.email}`);
}

function cmdVersion() {
  console.log(`dtunnel ${VERSION} (@desarrollado/dtunnel)`);
}

function formatTunnelTarget(t) {
  const host = t.localHost || DEFAULT_LOCAL_HOST;
  return formatLocalTarget(host, t.port);
}

async function cmdList(what) {
  if (what !== 'up') {
    console.error('Uso: dtunnel --list up');
    return 1;
  }

  const local = getLocalTunnel();
  const cfg = loadConfig();
  let remote = [];

  if (cfg.token) {
    try {
      const data = await apiFetch('/tunnels');
      remote = data.tunnels || [];
    } catch (err) {
      console.error(`No se pudo consultar la cuenta: ${err.message}`);
    }
  }

  if (!local && remote.length === 0) {
    const stale = getStaleTunnelState();
    if (stale?.subdomain) {
      console.log('HUÉRFANO (local sin proceso, aún en servidor)');
      console.log(`  ${stale.subdomain.padEnd(16)} ${formatTunnelTarget(stale)}  (ejecuta: dtunnel down)`);
      return;
    }
    console.log('No hay túneles activos.');
    if (!cfg.token) console.log('Inicia sesión con dtunnel login para ver túneles de tu cuenta.');
    return;
  }

  if (local) {
    console.log('LOCAL');
    console.log(`  ${local.subdomain.padEnd(16)} ${formatTunnelTarget(local)}  ${local.httpsUrl || ''}`);
  }

  if (remote.length > 0) {
    console.log(local ? '\nCUENTA' : 'CUENTA');
    for (const t of remote) {
      const marker = local?.subdomain === t.subdomain ? '*' : ' ';
      console.log(`${marker} ${t.subdomain.padEnd(16)} ${formatLocalTarget(DEFAULT_LOCAL_HOST, t.port)}  ${t.httpsUrl}`);
    }
    if (local) console.log('\n* = también activo en esta máquina');
  }
}

const args = parseArgs(process.argv);

async function main() {
  try {
    let code = 0;
    switch (args.cmd) {
      case 'help': usage(); break;
      case 'login': await cmdLogin(); break;
      case 'register': await cmdRegister(); break;
      case 'reserve': {
        const rc = await cmdReserve(args.subdomain);
        if (rc) return rc;
        break;
      }
      case 'config': {
        const rc = cmdConfig(process.argv);
        if (rc) return rc;
        break;
      }
      case 'down': await cmdDown(); break;
      case 'status': cmdStatus(); break;
      case 'logs': {
        const rc = await cmdLogs(args);
        if (rc) return rc;
        break;
      }
      case 'version': cmdVersion(); break;
      case 'list': {
        const rc = await cmdList(args.listWhat);
        if (rc) return rc;
        break;
      }
      case 'up': code = await cmdUp(args); break;
      default: usage(); code = 1;
    }
    return code;
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return 1;
  }
}

const exitCode = await main();
process.exit(exitCode);
