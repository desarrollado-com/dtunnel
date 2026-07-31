#!/usr/bin/env node
/**
 * Cliente de túnel nativo v2 — solo Node.js, sin binarios externos.
 */
import WebSocket from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import {
  BIN_THRESHOLD, WIRE_REQ, WIRE_RES, WIRE_WS_FRAME,
  decodeEnvelope, encodeEnvelope, isBinaryEnvelope,
} from './tunnel-wire.js';

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailers', 'transfer-encoding', 'upgrade',
]);

const LOCAL_STRIP_HEADERS = new Set([
  'origin', 'referer',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
]);

const WS_HANDSHAKE_HEADERS = new Set([
  'upgrade', 'connection',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol',
]);

const WS_OPEN_TIMEOUT_MS = 30_000;

function sendJson(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendRes(ws, id, status, headers, body = Buffer.alloc(0)) {
  if (!body.length || body.length < BIN_THRESHOLD) {
    sendJson(ws, {
      type: 'res',
      id,
      status,
      headers,
      body: body.length ? body.toString('base64') : undefined,
    });
    return;
  }
  ws.send(encodeEnvelope(WIRE_RES, id, { status, headers }, body));
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
    const lower = key.toLowerCase();
    if (LOCAL_STRIP_HEADERS.has(lower)) delete headers[key];
    // Node fetch auto-decompresses; asking upstream for gzip breaks Content-Encoding on the tunnel.
    if (lower === 'accept-encoding') delete headers[key];
  }
  if (!headers['x-forwarded-proto'] && !headers['X-Forwarded-Proto']) {
    headers['x-forwarded-proto'] = 'https';
  }
  return headers;
}

function buildWsOpenHeaders(incoming) {
  const headers = buildLocalHeaders(incoming);
  for (const key of Object.keys(headers)) {
    if (WS_HANDSHAKE_HEADERS.has(key.toLowerCase())) delete headers[key];
  }
  return headers;
}

/** @type {Map<string, import('ws').WebSocket>} */
const appSockets = new Map();

function closeAllAppSockets() {
  for (const [id, localWs] of appSockets) {
    try { localWs.close(); } catch { /* ignore */ }
    appSockets.delete(id);
  }
}

function handleWsOpen(controlWs, msg, localHost, localPort) {
  const path = msg.path || '/';
  const url = `ws://${localHost}:${localPort}${path}`;
  let localWs;
  try {
    localWs = new WebSocket(url, { headers: buildWsOpenHeaders(msg.headers || {}) });
  } catch (err) {
    sendJson(controlWs, { type: 'ws-error', id: msg.id, message: String(err.message || 'WebSocket failed') });
    return;
  }

  appSockets.set(msg.id, localWs);
  const timer = setTimeout(() => {
    if (appSockets.get(msg.id) !== localWs) return;
    appSockets.delete(msg.id);
    try { localWs.close(); } catch { /* ignore */ }
    sendJson(controlWs, { type: 'ws-error', id: msg.id, message: 'Local WebSocket timeout' });
  }, WS_OPEN_TIMEOUT_MS);

  localWs.on('open', () => {
    clearTimeout(timer);
    sendJson(controlWs, { type: 'ws-opened', id: msg.id });
  });

  localWs.on('message', (data, isBinary) => {
    const buf = Buffer.from(data);
    if (buf.length < BIN_THRESHOLD) {
      sendJson(controlWs, {
        type: 'ws-frame',
        id: msg.id,
        data: buf.toString('base64'),
        opcode: isBinary ? 2 : 1,
      });
      return;
    }
    controlWs.send(encodeEnvelope(WIRE_WS_FRAME, msg.id, { opcode: isBinary ? 2 : 1 }, buf));
  });

  localWs.on('close', (code, reason) => {
    if (appSockets.get(msg.id) === localWs) appSockets.delete(msg.id);
    sendJson(controlWs, { type: 'ws-close', id: msg.id, code, reason: reason.toString() });
  });

  localWs.on('error', () => {
    if (appSockets.get(msg.id) === localWs) appSockets.delete(msg.id);
    sendJson(controlWs, { type: 'ws-error', id: msg.id, message: 'Local WebSocket error' });
  });
}

function handleTunnelMessage(controlWs, msg, localHost, localPort) {
  if (msg.type === 'ready') return;
  if (msg.type === 'ping') {
    sendJson(controlWs, { type: 'pong' });
    return;
  }
  if (msg.type === 'ws-open' && msg.id) {
    handleWsOpen(controlWs, msg, localHost, localPort);
    return;
  }
  if (msg.type === 'ws-frame' && msg.id) {
    const localWs = appSockets.get(msg.id);
    if (localWs?.readyState === WebSocket.OPEN) {
      const buf = Buffer.from(msg.data || '', 'base64');
      localWs.send(buf, { binary: msg.opcode === 2 });
    }
    return;
  }
  if (msg.type === 'ws-close' && msg.id) {
    const localWs = appSockets.get(msg.id);
    appSockets.delete(msg.id);
    try { localWs?.close(msg.code || 1000, msg.reason || ''); } catch { /* ignore */ }
    return;
  }
  if (msg.type === 'req' && msg.id) {
    scheduleRequest(() => forwardRequest(controlWs, msg, localHost, localPort));
    return;
  }
}

async function forwardRequest(controlWs, msg, localHost, localPort) {
  try {
    const { status, headers, body } = await forwardToLocal(msg, localHost, localPort);
    sendRes(controlWs, msg.id, status, headers, body);
  } catch (err) {
    sendRes(controlWs, msg.id, 502, { 'content-type': 'text/plain' }, Buffer.from(String(err.message || 'Bad Gateway')));
  }
}

function handleTunnelWire(controlWs, packet, localHost, localPort) {
  if (packet.type === WIRE_REQ) {
    const reqMsg = {
      type: 'req',
      id: packet.id,
      method: packet.meta.method,
      path: packet.meta.path,
      headers: packet.meta.headers,
      body: packet.body.length ? packet.body.toString('base64') : undefined,
    };
    scheduleRequest(() => forwardRequest(controlWs, reqMsg, localHost, localPort));
    return;
  }
  if (packet.type === WIRE_WS_FRAME) {
    const localWs = appSockets.get(packet.id);
    if (localWs?.readyState === WebSocket.OPEN) {
      localWs.send(packet.body, { binary: packet.meta.opcode === 2 });
    }
  }
}

const MAX_CONCURRENT = 32;
let activeRequests = 0;
/** @type {Array<() => void>} */
const requestQueue = [];

function drainRequestQueue() {
  while (activeRequests < MAX_CONCURRENT && requestQueue.length > 0) {
    const run = requestQueue.shift();
    if (run) run();
  }
}

function scheduleRequest(fn) {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeRequests += 1;
      Promise.resolve(fn())
        .then(resolve, reject)
        .finally(() => {
          activeRequests -= 1;
          drainRequestQueue();
        });
    };
    if (activeRequests < MAX_CONCURRENT) run();
    else requestQueue.push(run);
  });
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
  res.headers.forEach((v, k) => {
    const lower = k.toLowerCase();
    if (lower === 'content-encoding' || lower === 'content-length') return;
    resHeaders[k] = v;
  });
  return {
    status: res.status,
    headers: resHeaders,
    body: buf,
  };
}

export function startNativeTunnel({ wsUrl, tunnelToken, localHost = '127.0.0.1', localPort, onReady, onClose, onError }) {
  const url = `${wsUrl}${wsUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(tunnelToken)}`;
  const ws = new WebSocket(url, { perMessageDeflate: true });

  ws.on('open', () => {
    onReady?.();
  });

  ws.on('message', (raw, isBinary) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (isBinary || isBinaryEnvelope(buf)) {
      const packet = decodeEnvelope(buf);
      if (packet) handleTunnelWire(ws, packet, localHost, localPort);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    handleTunnelMessage(ws, msg, localHost, localPort);
  });

  ws.on('close', () => {
    closeAllAppSockets();
    onClose?.();
  });
  ws.on('error', (err) => onError?.(err));

  const pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) sendJson(ws, { type: 'ping' });
  }, 30_000);

  return {
    close() {
      clearInterval(pingTimer);
      closeAllAppSockets();
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
