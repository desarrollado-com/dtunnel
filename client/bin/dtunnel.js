#!/usr/bin/env node
/**
 * dtunnel CLI — expone localhost como URL pública
 * Uso: dtunnel --port 88080
 *      dtunnel --port 3000 --subdomain mi-api
 *      dtunnel login
 *      dtunnel down
 */
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(homedir(), '.dtunnel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const PID_FILE = join(CONFIG_DIR, 'frpc.pid');
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

function parseArgs(argv) {
  const args = { port: null, subdomain: null, cmd: 'up' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--subdomain' || a === '-s') args.subdomain = argv[++i];
    else if (a === 'login') args.cmd = 'login';
    else if (a === 'down' || a === 'stop') args.cmd = 'down';
    else if (a === 'register') args.cmd = 'register';
    else if (a === 'reserve') { args.cmd = 'reserve'; args.subdomain = argv[++i]; }
    else if (a === '--help' || a === '-h') args.cmd = 'help';
    else if (!a.startsWith('-') && !args.port) args.port = Number(a);
  }
  return args;
}

function usage() {
  console.log(`
dtunnel — URL pública para tu servidor local

  dtunnel --port <puerto>              Túnel con subdominio aleatorio
  dtunnel --port <puerto> -s <nombre>  Túnel con subdominio reservado
  dtunnel login                        Iniciar sesión
  dtunnel register                     Crear cuenta
  dtunnel reserve <nombre>             Reservar subdominio (requiere login)
  dtunnel down                         Detener túnel

Variables:
  DTUNNEL_API_URL   ${DEFAULT_API}
`);
}

function findFrpc() {
  try {
    const p = execSync(process.platform === 'win32' ? 'where frpc' : 'which frpc', {
      encoding: 'utf8',
    }).trim().split('\n')[0];
    return p;
  } catch {
    return null;
  }
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

  const body = { port: args.port };
  if (args.subdomain) body.subdomain = args.subdomain;

  const data = await apiFetch('/tunnels', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const frpc = findFrpc();
  if (!frpc) {
    console.error('Instala frpc: https://github.com/fatedier/frp/releases');
    process.exit(1);
  }

  if (existsSync(PID_FILE)) {
    try {
      const pid = Number(readFileSync(PID_FILE, 'utf8'));
      process.kill(pid, 0);
      console.error('Ya hay un túnel activo. Ejecuta: dtunnel down');
      process.exit(1);
    } catch { /* stale pid */ }
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

  console.log('');
  console.log(`${data.httpUrl}  ⟶  http://localhost:${args.port}`);
  console.log(`${data.httpsUrl}  ⟶  http://localhost:${args.port}`);
  console.log('');
  console.log('Ctrl+C no detiene el túnel. Usa: dtunnel down');
}

function cmdDown() {
  if (existsSync(PID_FILE)) {
    const pid = Number(readFileSync(PID_FILE, 'utf8'));
    try { process.kill(pid); } catch { /* ignore */ }
    unlinkSync(PID_FILE);
  }
  if (existsSync(FRPC_CONF)) unlinkSync(FRPC_CONF);
  console.log('Túnel detenido');
}

const args = parseArgs(process.argv);

switch (args.cmd) {
  case 'help': usage(); break;
  case 'login': await cmdLogin(); break;
  case 'register': await cmdRegister(); break;
  case 'reserve': await cmdReserve(args.subdomain); break;
  case 'down': cmdDown(); break;
  case 'up': await cmdUp(args); break;
  default: usage(); process.exit(1);
}
