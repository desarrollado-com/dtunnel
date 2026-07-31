/**
 * Gateway HTTP y WebSocket para túneles públicos (*.dominio).
 */
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { renderInactiveTunnelPage, wantsHtmlPage } from './inactive-page.js';
import {
  BIN_THRESHOLD, WIRE_REQ, WIRE_RES, WIRE_WS_FRAME,
  decodeEnvelope, encodeEnvelope, isBinaryEnvelope,
} from './wire.js';
import { recordRequestTrace } from '../request-trace.js';
import { inspectTunnelTraffic } from '../security/threat-handler.js';

const REQUEST_TIMEOUT_MS = 60_000;
const WS_OPEN_TIMEOUT_MS = 30_000;

/** Headers that break local dev servers (Next.js allowedDevOrigins) when tunneled. */
const LOCAL_STRIP_HEADERS = new Set([
  'origin', 'referer',
  'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
]);

/** WebSocket handshake headers — only for the browser↔gateway leg. */
const WS_HANDSHAKE_HEADERS = new Set([
  'upgrade', 'connection',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions', 'sec-websocket-protocol',
]);

export function sanitizeHeadersForLocalBackend(headers) {
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    if (LOCAL_STRIP_HEADERS.has(key.toLowerCase())) delete out[key];
  }
  return out;
}

function buildForwardedHeaders(req) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const publicHost = headers['x-forwarded-host'] || req.headers.host;
  if (publicHost && !headers['x-forwarded-host']) {
    headers['x-forwarded-host'] = publicHost;
  }
  if (!headers['x-forwarded-proto']) {
    headers['x-forwarded-proto'] = 'https';
  }
  if (!headers['x-forwarded-for']) {
    headers['x-forwarded-for'] = req.socket?.remoteAddress || '';
  }
  return sanitizeHeadersForLocalBackend(headers);
}

function buildWsOpenHeaders(req) {
  const headers = buildForwardedHeaders(req);
  for (const key of Object.keys(headers)) {
    if (WS_HANDSHAKE_HEADERS.has(key.toLowerCase())) delete headers[key];
  }
  return headers;
}

function teardownWsBridge(id, { skipTunnel = false, skipBrowser = false, code = 1000, reason = '' } = {}) {
  const bridge = wsBridges.get(id);
  if (!bridge || bridge.closed) return;
  bridge.closed = true;
  wsBridges.delete(id);
  if (bridge.timer) clearTimeout(bridge.timer);
  if (!skipBrowser) {
    try { bridge.browserWs?.close(code, reason); } catch { /* ignore */ }
  }
  if (!skipTunnel && bridge.tunnelWs?.readyState === bridge.tunnelWs.OPEN) {
    sendWs(bridge.tunnelWs, { type: 'ws-close', id, code, reason });
  }
}

function teardownTunnelWsBridges(tunnelWs) {
  for (const [id, bridge] of wsBridges) {
    if (bridge.tunnelWs === tunnelWs) teardownWsBridge(id, { skipTunnel: true });
  }
}

function handleTunnelWsMessage(ws, msg) {
  if (msg.type === 'res' && msg.id && pending.has(msg.id)) {
    pending.get(msg.id).resolve(msg);
    return;
  }
  if (msg.type === 'ws-opened' && msg.id && wsBridges.has(msg.id)) {
    const bridge = wsBridges.get(msg.id);
    if (bridge?.timer) clearTimeout(bridge.timer);
    return;
  }
  if (msg.type === 'ws-frame' && msg.id && wsBridges.has(msg.id)) {
    const bridge = wsBridges.get(msg.id);
    if (bridge?.browserWs?.readyState === bridge.browserWs.OPEN) {
      const buf = Buffer.from(msg.data || '', 'base64');
      bridge.browserWs.send(buf, { binary: msg.opcode === 2 });
    }
    return;
  }
  if (msg.type === 'ws-close' && msg.id) {
    teardownWsBridge(msg.id, { skipTunnel: true, code: msg.code || 1000, reason: msg.reason || '' });
    return;
  }
  if (msg.type === 'ws-error' && msg.id) {
    teardownWsBridge(msg.id, { skipTunnel: true, code: 1011, reason: msg.message || 'error' });
    return;
  }
  if (msg.type === 'ping') sendWs(ws, { type: 'pong' });
}

/** @type {import('ws').WebSocketServer | null} */
let appWss = null;

function proxyWsToTunnel(req, socket, head, entry) {
  if (!appWss) {
    socket.destroy();
    return;
  }
  const id = randomUUID();
  const path = req.url || '/';
  const localHeaders = buildWsOpenHeaders(req);
  const timer = setTimeout(
    () => teardownWsBridge(id, { code: 1011, reason: 'Gateway Timeout' }),
    WS_OPEN_TIMEOUT_MS,
  );

  appWss.handleUpgrade(req, socket, head, (browserWs) => {
    wsBridges.set(id, { browserWs, tunnelWs: entry.ws, timer });

    browserWs.on('message', (data, isBinary) => {
      const buf = Buffer.from(data);
      if (buf.length < BIN_THRESHOLD) {
        sendWs(entry.ws, {
          type: 'ws-frame',
          id,
          data: buf.toString('base64'),
          opcode: isBinary ? 2 : 1,
        });
        return;
      }
      entry.ws.send(encodeEnvelope(WIRE_WS_FRAME, id, { opcode: isBinary ? 2 : 1 }, buf));
    });

    browserWs.on('close', (code, reason) => {
      teardownWsBridge(id, { skipBrowser: true, code, reason: reason.toString() });
    });

    browserWs.on('error', () => {
      teardownWsBridge(id, { skipBrowser: true, code: 1011, reason: 'Browser WebSocket error' });
    });

    sendWs(entry.ws, { type: 'ws-open', id, path, headers: localHeaders });
  });
}

/** @type {Map<string, { ws: import('ws').WebSocket, port: number }>} */
const tunnels = new Map();

/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
const pending = new Map();

/** @type {Map<string, { browserWs: import('ws').WebSocket, tunnelWs: import('ws').WebSocket, timer?: NodeJS.Timeout, closed?: boolean }>} */
const wsBridges = new Map();

export function createTunnelAccessToken({ subdomain, tunnelId, port }, jwtSecret) {
  return jwt.sign(
    { typ: 'tunnel', subdomain, tunnelId, port },
    jwtSecret,
    { expiresIn: '24h' },
  );
}

export function verifyTunnelAccessToken(token, jwtSecret) {
  const payload = jwt.verify(token, jwtSecret);
  if (payload.typ !== 'tunnel' || !payload.subdomain) {
    throw new Error('Token de túnel inválido');
  }
  return payload;
}

function extractSubdomain(host, domain) {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase();
  const suffix = `.${domain.toLowerCase()}`;
  if (!h.endsWith(suffix)) return null;
  const sub = h.slice(0, -suffix.length);
  if (!sub || sub.includes('.')) return null;
  return sub;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendWs(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendReq(ws, id, method, path, headers, body = Buffer.alloc(0)) {
  if (!body.length || body.length < BIN_THRESHOLD) {
    sendWs(ws, {
      type: 'req',
      id,
      method,
      path,
      headers,
      body: body.length ? body.toString('base64') : undefined,
    });
    return;
  }
  ws.send(encodeEnvelope(WIRE_REQ, id, { method, path, headers }, body));
}

function finishHttpResponse(res, response) {
  if (res.headersSent) return;
  res.statusCode = response.status || 502;
  const skip = new Set(['transfer-encoding', 'connection', 'keep-alive', 'content-length', 'content-encoding']);
  for (const [k, v] of Object.entries(response.headers || {})) {
    if (!skip.has(k.toLowerCase())) res.setHeader(k, v);
  }
  const body = response.bodyBuf
    ?? (response.body ? Buffer.from(response.body, 'base64') : Buffer.alloc(0));
  res.setHeader('Content-Length', String(body.length));
  res.end(body);
}

function handleTunnelWireMessage(ws, packet) {
  if (packet.type === WIRE_RES && packet.id && pending.has(packet.id)) {
    pending.get(packet.id).resolve({
      status: packet.meta.status,
      headers: packet.meta.headers,
      bodyBuf: packet.body,
    });
    return;
  }
  if (packet.type === WIRE_WS_FRAME && packet.id && wsBridges.has(packet.id)) {
    const bridge = wsBridges.get(packet.id);
    if (bridge?.browserWs?.readyState === bridge.browserWs.OPEN) {
      bridge.browserWs.send(packet.body, { binary: packet.meta.opcode === 2 });
    }
  }
}

function proxyHttpToTunnel(req, res, subdomain, entry, findTunnelBySubdomain) {
  const id = randomUUID();
  const path = req.url || '/';
  const localHeaders = buildForwardedHeaders(req);
  const started = Date.now();
  const clientIp = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0].trim() || null;
  const userAgent = req.headers['user-agent'] || null;
  const tunnelRow = findTunnelBySubdomain ? findTunnelBySubdomain(subdomain) : null;
  const userId = tunnelRow?.user_id ?? null;
  const fingerprintHash = tunnelRow?.fingerprint_hash ?? null;

  const threat = inspectTunnelTraffic({
    method: req.method || 'GET',
    path,
    headers: req.headers,
    clientIp,
    userId,
    subdomain,
    fingerprintHash,
    userAgent,
  });
  if (threat.blocked) {
    if (!res.headersSent) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`Bloqueado por seguridad: ${threat.reason}`);
    }
    recordRequestTrace({
      requestId: id,
      userId,
      subdomain,
      method: req.method || 'GET',
      path,
      status: 403,
      durationMs: 0,
      bytesIn: 0,
      bytesOut: 0,
      clientIp,
      userAgent,
      error: threat.reason,
    });
    return;
  }

  let traced = false;
  let bytesIn = 0;

  function finishTrace({ status, bytesOut = 0, error = null }) {
    if (traced) return;
    traced = true;
    try {
      recordRequestTrace({
        requestId: id,
        userId,
        subdomain,
        method: req.method || 'GET',
        path,
        status,
        durationMs: Date.now() - started,
        bytesIn,
        bytesOut,
        clientIp,
        userAgent,
        error,
      });
    } catch { /* ignore */ }
  }

  const timer = setTimeout(() => {
    pending.delete(id);
    finishTrace({ status: 504, error: 'Gateway Timeout' });
    if (!res.headersSent) {
      res.statusCode = 504;
      res.end('Gateway Timeout');
    }
  }, REQUEST_TIMEOUT_MS);

  pending.set(id, {
    resolve: (response) => {
      clearTimeout(timer);
      pending.delete(id);
      const body = response.bodyBuf
        ?? (response.body ? Buffer.from(response.body, 'base64') : Buffer.alloc(0));
      finishTrace({ status: response.status || 502, bytesOut: body.length });
      finishHttpResponse(res, response);
    },
    reject: () => {
      clearTimeout(timer);
      pending.delete(id);
      finishTrace({ status: 502, error: 'Bad Gateway' });
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end('Bad Gateway');
      }
    },
    timer,
  });

  readBody(req).then((body) => {
    bytesIn = body.length;
    sendReq(entry.ws, id, req.method || 'GET', path, localHeaders, body);
  }).catch(() => {
    clearTimeout(timer);
    pending.delete(id);
    finishTrace({ status: 400, error: 'Bad Request' });
    if (!res.headersSent) {
      res.statusCode = 400;
      res.end('Bad Request');
    }
  });
}

export function unregisterTunnel(subdomain) {
  const key = subdomain.toLowerCase();
  const entry = tunnels.get(key);
  if (entry?.ws) {
    try { entry.ws.close(); } catch { /* ignore */ }
  }
  tunnels.delete(key);
}

export function startNativeTunnelServer({
  jwtSecret,
  domain,
  httpHost = '127.0.0.1',
  httpPort = 18080,
  apiServer,
  findTunnelBySubdomain,
  getInactiveSubdomainStatus,
  mainSite = `https://${domain}`,
  extraUpgradeHandlers = [],
}) {
  function sendInactivePage(req, res, subdomain) {
    const info = getInactiveSubdomainStatus
      ? getInactiveSubdomainStatus(subdomain)
      : { status: 'available', subdomain };
    if (wantsHtmlPage(req)) {
      const html = renderInactiveTunnelPage({
        subdomain,
        domain,
        status: info.status,
        mainSite,
      });
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(html);
      return;
    }
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: 'tunnel_inactive',
      status: info.status,
      subdomain,
      message: 'Túnel no activo',
    }));
  }

  const httpServer = createServer(async (req, res) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const subdomain = extractSubdomain(host, domain);
    if (!subdomain) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    const entry = tunnels.get(subdomain);
    const wsLive = entry && entry.ws.readyState === entry.ws.OPEN;
    if (!wsLive) {
      sendInactivePage(req, res, subdomain);
      return;
    }
    if (findTunnelBySubdomain && !findTunnelBySubdomain(subdomain)) {
      sendInactivePage(req, res, subdomain);
      return;
    }
    proxyHttpToTunnel(req, res, subdomain, entry, findTunnelBySubdomain);
  });

  appWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const subdomain = extractSubdomain(host, domain);
    if (!subdomain) {
      socket.destroy();
      return;
    }
    const entry = tunnels.get(subdomain);
    const wsLive = entry && entry.ws.readyState === entry.ws.OPEN;
    if (!wsLive || (findTunnelBySubdomain && !findTunnelBySubdomain(subdomain))) {
      socket.destroy();
      return;
    }
    proxyWsToTunnel(req, socket, head, entry);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Puerto ${httpPort} en uso. Libera el puerto o ajusta TUNNEL_HTTP_PORT.`,
      );
    }
    throw err;
  });

  httpServer.listen(httpPort, httpHost, () => {
    console.log(`dtunnel-native HTTP en http://${httpHost}:${httpPort} (*.${domain})`);
  });

  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    let payload;
    try {
      payload = verifyTunnelAccessToken(token, jwtSecret);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }
    if (findTunnelBySubdomain && !findTunnelBySubdomain(payload.subdomain)) {
      ws.close(4004, 'Tunnel not found');
      return;
    }

    const key = payload.subdomain.toLowerCase();
    const prev = tunnels.get(key);
    if (prev?.ws) {
      try { prev.ws.close(); } catch { /* ignore */ }
    }
    tunnels.set(key, { ws, port: payload.port });

    ws.on('message', (raw, isBinary) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (isBinary || isBinaryEnvelope(buf)) {
        const packet = decodeEnvelope(buf);
        if (packet) handleTunnelWireMessage(ws, packet);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(buf.toString('utf8'));
      } catch {
        return;
      }
      handleTunnelWsMessage(ws, msg);
    });

    ws.on('close', () => {
      teardownTunnelWsBridges(ws);
      if (tunnels.get(key)?.ws === ws) tunnels.delete(key);
    });

    sendWs(ws, { type: 'ready', subdomain: key });
  });

  apiServer.on('upgrade', (req, socket, head) => {
    for (const handler of extraUpgradeHandlers) {
      if (handler(req, socket, head)) return;
    }
    if (!req.url?.startsWith('/tunnel/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return { httpServer, wss, tunnels };
}
