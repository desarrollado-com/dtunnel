#!/usr/bin/env node
/**
 * Cliente de túnel nativo v2 — solo Node.js, sin binarios externos.
 */
import WebSocket from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

const LOCAL_STRIP_HEADERS = new Set([
  'origin', 'referer',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
]);

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function filterHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const lower = k.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    out[k] = v;
  }
  return out;
}

function buildLocalHeaders(incoming) {
  const headers = filterHeaders(incoming);
  for (const key of Object.keys(headers)) {
    if (LOCAL_STRIP_HEADERS.has(key.toLowerCase())) delete headers[key];
  }
  if (!headers['x-forwarded-proto'] && !headers['X-Forwarded-Proto']) {
    headers['x-forwarded-proto'] = 'https';
  }
  return headers;
}

async function forwardToLocal({ method, path, headers, body }, localHost, localPort) {
  const url = `http://${localHost}:${localPort}${path}`;
  const init = {
    method: method || 'GET',
    headers: buildLocalHeaders(headers),
  };
  if (body) init.body = Buffer.from(body, 'base64');
  const res = await fetch(url, init);
  const buf = Buffer.from(await res.arrayBuffer());
  const resHeaders = {};
  res.headers.forEach((v, k) => { resHeaders[k] = v; });
  return {
    status: res.status,
    headers: resHeaders,
    body: buf.length ? buf.toString('base64') : undefined,
  };
}

export function startNativeTunnel({ wsUrl, tunnelToken, localHost = '127.0.0.1', localPort, onReady, onClose, onError }) {
  const url = `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(tunnelToken)}`;
  const ws = new WebSocket(url);

  ws.on('open', () => {
    onReady?.();
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.type === 'ready') return;
    if (msg.type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }
    if (msg.type !== 'req' || !msg.id) return;
    try {
      const response = await forwardToLocal(msg, localHost, localPort);
      send(ws, { type: 'res', id: msg.id, ...response });
    } catch (err) {
      send(ws, {
        type: 'res',
        id: msg.id,
        status: 502,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from(String(err.message || 'Bad Gateway')).toString('base64'),
      });
    }
  });

  ws.on('close', () => onClose?.());
  ws.on('error', (err) => onError?.(err));

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) send(ws, { type: 'ping' });
  }, 30_000);

  return {
    close() {
      clearInterval(pingTimer);
      try { ws.close(); } catch { /* ignore */ }
    },
    ws,
  };
}

/** Proceso detached: mantiene el túnel abierto en segundo plano */
export function runNativeTunnelDaemon({ wsUrl, tunnelToken, localHost = '127.0.0.1', localPort, subdomain }) {
  const keepAlive = createServer((_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  keepAlive.listen(0, '127.0.0.1');

  const tunnel = startNativeTunnel({
    wsUrl,
    tunnelToken,
    localHost,
    localPort,
    onClose: () => process.exit(0),
    onError: () => process.exit(1),
  });

  process.on('SIGTERM', () => {
    tunnel.close();
    keepAlive.close();
    process.exit(0);
  });

  console.log(JSON.stringify({ ok: true, subdomain, localHost, localPort }));
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((acc, cur, i, arr) => {
      if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
      return acc;
    }, []),
  );
  if (!args['ws-url'] || !args.token || !args.port) {
    console.error('Uso: native-client.js --ws-url <url> --token <jwt> --port <localPort> [--host <localHost>]');
    process.exit(1);
  }
  runNativeTunnelDaemon({
    wsUrl: args['ws-url'],
    tunnelToken: args.token,
    localHost: args.host || '127.0.0.1',
    localPort: Number(args.port),
    subdomain: args.subdomain,
  });
}
