#!/usr/bin/env node
/**
 * Smoke tests — comprobaciones rápidas post-deploy.
 * Uso: node scripts/smoke-test.mjs [baseUrl]
 *      BASE_URL=https://dtunnel.desarrollado.com node scripts/smoke-test.mjs
 */

const BASE = (process.argv[2] || process.env.BASE_URL || 'https://dtunnel.desarrollado.com').replace(/\/$/, '');
const API = `${BASE}/api`;

const checks = [];

function ok(name, detail = '') {
  checks.push({ name, pass: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  checks.push({ name, pass: false, detail });
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function getJson(path, { expectStatus = 200 } = {}) {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expectStatus) {
    throw new Error(`HTTP ${res.status}: ${data.error || res.statusText}`);
  }
  return data;
}

function wsProbe(url, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve(true);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('connection failed'));
    });
  });
}

console.log(`\ndtunnel smoke tests → ${BASE}\n`);

try {
  const health = await getJson('/health');
  if (health.ok && health.service === 'dtunnel-api') {
    ok('API /health', `v${health.version || '?'}`);
  } else {
    fail('API /health', JSON.stringify(health));
  }
} catch (err) {
  fail('API /health', err.message);
}

try {
  const plans = await getJson('/plans');
  if (Array.isArray(plans.plans) && plans.plans.length > 0) {
    ok('API /plans', `${plans.plans.length} plan(es)`);
  } else {
    fail('API /plans', 'sin planes');
  }
} catch (err) {
  fail('API /plans', err.message);
}

try {
  const status = await getJson('/status');
  if (status.api === 'ok') ok('API /status');
  else fail('API /status', JSON.stringify(status));
} catch (err) {
  fail('API /status', err.message);
}

const wsPaths = [
  '/admin/ws/console',
  '/admin/ws/metrics',
];

for (const path of wsPaths) {
  const wsUrl = `${API.replace(/^http/, 'ws')}${path}`;
  try {
    await wsProbe(wsUrl);
    ok(`WebSocket upgrade ${path}`, 'conexión TCP/upgrade OK');
  } catch (err) {
    fail(`WebSocket upgrade ${path}`, err.message);
  }
}

try {
  const landing = await fetch(`${BASE}/`);
  if (landing.ok) ok('Web landing', `HTTP ${landing.status}`);
  else fail('Web landing', `HTTP ${landing.status}`);
} catch (err) {
  fail('Web landing', err.message);
}

try {
  const dash = await fetch(`${BASE}/dashboard.html`);
  if (dash.ok) ok('Web dashboard.html');
  else fail('Web dashboard.html', `HTTP ${dash.status}`);
} catch (err) {
  fail('Web dashboard.html', err.message);
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} OK\n`);
process.exit(failed.length ? 1 : 0);
