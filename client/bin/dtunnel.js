#!/usr/bin/env node
/**
 * dtunnel CLI — expone localhost como URL pública
 */
import { ensureFrpcBinary, findFrpcBinary } from './frpc-install.js';
import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = PKG.version;
const CONFIG_DIR = join(homedir(), '.dtunnel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PID_FILE = join(CONFIG_DIR, 'frpc.pid');
const HEARTBEAT_PID_FILE = join(CONFIG_DIR, 'heartbeat.pid');
const STATE_FILE = join(CONFIG_DIR, 'tunnel.json');
const FRPC_CONF = join(CONFIG_DIR, 'frpc.toml');

const DEFAULT_API = 'https://dtunnel.desarrollado.com/api';
const DEFAULT_DOMAIN = 'dtunnel.desarrollado.com';

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
  try { process.kill(pid); } catch { /* ignore */ }
  unlinkSync(HEARTBEAT_PID_FILE);
}

function startHeartbeat() {
  stopHeartbeat();
  const hbScript = join(__dirname, 'tunnel-heartbeat.js');
  const child = spawn(process.execPath, [hbScript], { stdio: 'ignore', detached: true });
  child.unref();
  writeFileSync(HEARTBEAT_PID_FILE, String(child.pid));
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
  const pid = state?.pid ?? (existsSync(PID_FILE) ? Number(readFileSync(PID_FILE, 'utf8')) : null);
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
    /* ignore — puede que ya no exista en el servidor */
  }
  clearTunnelState();
  if (existsSync(FRPC_CONF)) unlinkSync(FRPC_CONF);
}

function parseArgs(argv) {
  const args = { port: null, subdomain: null, cmd: 'up', listWhat: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--subdomain' || a === '-s') args.subdomain = argv[++i];
    else if (a === '--list') { args.cmd = 'list'; args.listWhat = argv[++i]; }
    else if (a === 'login') args.cmd = 'login';
    else if (a === 'down' || a === 'stop') args.cmd = 'down';
    else if (a === 'register') args.cmd = 'register';
    else if (a === 'status') args.cmd = 'status';
    else if (a === 'version' || a === '-v' || a === '--version') args.cmd = 'version';
    else if (a === 'list') { args.cmd = 'list'; args.listWhat = argv[++i] || 'up'; }
    else if (a === 'reserve') { args.cmd = 'reserve'; args.subdomain = argv[++i]; }
    else if (a === 'install-frpc') args.cmd = 'install-frpc';
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
  dtunnel status                       Estado del túnel local
  dtunnel --list up                    Listar túneles activos
  dtunnel version                      Versión instalada
  dtunnel login                        Iniciar sesión
  dtunnel register                     Crear cuenta
  dtunnel reserve <nombre>             Reservar subdominio (requiere login)
  dtunnel down                         Detener túnel
  dtunnel install-frpc                 Descargar frpc a ~/.dtunnel/bin

Variables:
  DTUNNEL_API_URL   ${DEFAULT_API}
`);
}

function findFrpc() {
  return findFrpcBinary();
}

async function cmdInstallFrpc() {
  const path = await ensureFrpcBinary();
  console.log(`frpc listo: ${path}`);
}

async function apiFetch(path, options = {}) {
  const cfg = loadConfig();
  const base = process.env.DTUNNEL_API_URL || cfg.apiUrl || DEFAULT_API;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(`${base}${path}`, { ...options, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
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
  const data = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const cfg = loadConfig();
  cfg.token = data.token;
  cfg.email = data.email;
  saveConfig(cfg);
  console.log(`Sesión iniciada como ${data.email}`);
}

async function cmdRegister() {
  const email = await prompt('Email: ');
  const password = await prompt('Contraseña (mín. 8): ');
  const data = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const cfg = loadConfig();
  cfg.token = data.token;
  cfg.email = data.email;
  saveConfig(cfg);
  console.log(`Cuenta creada: ${data.email}`);
}

async function cmdReserve(name) {
  if (!name) { console.error('Uso: dtunnel reserve <nombre>'); process.exit(1); }
  const data = await apiFetch('/subdomains/reserve', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  console.log(`Reservado: ${data.url}`);
}

function writeFrpcToml({ server, serverPort, token, subdomain, port }) {
  const escaped = token.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `serverAddr = "${server}"
serverPort = ${serverPort}

auth.method = "token"
auth.token = "${escaped}"

[[proxies]]
name = "${subdomain}"
type = "http"
localIP = "127.0.0.1"
localPort = ${port}
subdomain = "${subdomain}"
`;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(FRPC_CONF, content);
}

async function cmdUp(args) {
  if (!args.port) { usage(); process.exit(1); }

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
        console.error('Si el túnel ya no corre localmente, dtunnel down libera el registro en el servidor.');
        process.exit(1);
      }
    } else if (String(err.message).includes('Límite de túneles')) {
      console.error(err.message);
      console.error('Ejecuta: dtunnel down');
      process.exit(1);
    } else {
      throw err;
    }
  }

  const frpc = await ensureFrpcBinary();
  if (!frpc) {
    console.error('No se pudo instalar frpc. Ejecuta: dtunnel install-frpc');
    process.exit(1);
  }

  if (getLocalTunnel()) {
    console.error('Ya hay un túnel activo. Ejecuta: dtunnel down');
    process.exit(1);
  }

  writeFrpcToml({
    server: data.server,
    serverPort: data.serverPort,
    token: data.token,
    subdomain: data.subdomain,
    port: args.port,
  });

  const child = spawn(frpc, ['-c', FRPC_CONF], { stdio: 'ignore', detached: true });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  saveTunnelState({
    pid: child.pid,
    tunnelId: data.tunnelId,
    subdomain: data.subdomain,
    port: args.port,
    httpUrl: data.httpUrl,
    httpsUrl: data.httpsUrl,
    host: data.host || `${data.subdomain}.${DEFAULT_DOMAIN}`,
    startedAt: new Date().toISOString(),
  });
  startHeartbeat();

  console.log('');
  console.log(`${data.httpUrl}  ⟶  http://localhost:${args.port}`);
  console.log(`${data.httpsUrl}  ⟶  http://localhost:${args.port}`);
  console.log('');
  console.log('Ctrl+C no detiene el túnel. Usa: dtunnel down');
}

async function cmdDown() {
  stopHeartbeat();
  const state = loadTunnelState();
  const local = getLocalTunnel();

  if (local?.pid) {
    try { process.kill(local.pid); } catch { /* ignore */ }
  } else if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, 'utf8'));
    try { process.kill(pid); } catch { /* ignore */ }
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
  if (existsSync(FRPC_CONF)) unlinkSync(FRPC_CONF);
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
  console.log(`  Puerto:     localhost:${local.port}`);
  if (local.httpUrl) console.log(`  HTTP:       ${local.httpUrl}`);
  if (local.httpsUrl) console.log(`  HTTPS:      ${local.httpsUrl}`);
  console.log(`  PID frpc:   ${local.pid}`);
  if (local.startedAt) console.log(`  Desde:      ${local.startedAt}`);
  if (cfg.email) console.log(`  Sesión:     ${cfg.email}`);
}

function cmdVersion() {
  console.log(`dtunnel ${VERSION} (@desarrollado/dtunnel)`);
}

async function cmdList(what) {
  if (what !== 'up') {
    console.error('Uso: dtunnel --list up');
    process.exit(1);
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
      console.log(`  ${stale.subdomain.padEnd(16)} localhost:${stale.port}  (ejecuta: dtunnel down)`);
      return;
    }
    console.log('No hay túneles activos.');
    if (!cfg.token) console.log('Inicia sesión con dtunnel login para ver túneles de tu cuenta.');
    return;
  }

  if (local) {
    console.log('LOCAL');
    console.log(`  ${local.subdomain.padEnd(16)} localhost:${local.port}  ${local.httpsUrl || ''}`);
  }

  if (remote.length > 0) {
    console.log(local ? '\nCUENTA' : 'CUENTA');
    for (const t of remote) {
      const marker = local?.subdomain === t.subdomain ? '*' : ' ';
      console.log(`${marker} ${t.subdomain.padEnd(16)} localhost:${t.port}  ${t.httpsUrl}`);
    }
    if (local) {
      console.log('\n* = también activo en esta máquina');
    }
  }
}

const args = parseArgs(process.argv);

switch (args.cmd) {
  case 'help': usage(); break;
  case 'login': await cmdLogin(); break;
  case 'register': await cmdRegister(); break;
  case 'reserve': await cmdReserve(args.subdomain); break;
  case 'down': await cmdDown(); break;
  case 'status': cmdStatus(); break;
  case 'version': cmdVersion(); break;
  case 'install-frpc': await cmdInstallFrpc(); break;
  case 'list': await cmdList(args.listWhat); break;
  case 'up': await cmdUp(args); break;
  default: usage(); process.exit(1);
}
