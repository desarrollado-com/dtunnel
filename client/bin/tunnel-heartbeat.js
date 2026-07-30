#!/usr/bin/env node
/**
 * Proceso en segundo plano: mantiene vivo el registro del túnel en la API.
 */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.dtunnel');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const STATE_FILE = join(CONFIG_DIR, 'tunnel.json');
const DEFAULT_API = 'https://dtunnel.desarrollado.com/api';
const INTERVAL_MS = Number(process.env.DTUNNEL_HEARTBEAT_MS || 120_000);

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
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

async function sendHeartbeat() {
  const state = loadState();
  if (!state?.subdomain) return false;
  if (state.pid && !isPidRunning(state.pid)) return false;

  const cfg = loadConfig();
  const base = process.env.DTUNNEL_API_URL || cfg.apiUrl || DEFAULT_API;
  const headers = { ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) };

  const res = await fetch(`${base}/tunnels/${encodeURIComponent(state.subdomain)}/heartbeat`, {
    method: 'POST',
    headers,
  });
  return res.ok;
}

async function tick() {
  try {
    const ok = await sendHeartbeat();
    if (!ok) {
      const state = loadState();
      if (!state?.subdomain) process.exit(0);
    }
  } catch {
    /* reintentar en el siguiente ciclo */
  }
}

await tick();
setInterval(tick, INTERVAL_MS);
