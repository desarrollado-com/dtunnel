/**
 * Túnel HTTP nativo (v2) — sin frpc.
 * WebSocket para control; HTTP :18080 para tráfico público entrante.
 */
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { renderInactiveTunnelPage, wantsHtmlPage } from './inactive-page.js';

const REQUEST_TIMEOUT_MS = 60_000;

/** @type {Map<string, { ws: import('ws').WebSocket, port: number }>} */
const tunnels = new Map();

/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
const pending = new Map();

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

function proxyHttpToTunnel(req, res, subdomain, entry) {
  const id = randomUUID();
  const path = req.url || '/';
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

  const timer = setTimeout(() => {
    pending.delete(id);
    if (!res.headersSent) {
      res.statusCode = 504;
      res.end('Gateway Timeout');
    }
  }, REQUEST_TIMEOUT_MS);

  pending.set(id, {
    resolve: (response) => {
      clearTimeout(timer);
      pending.delete(id);
      if (res.headersSent) return;
      res.statusCode = response.status || 502;
      const skip = new Set(['transfer-encoding', 'connection', 'keep-alive']);
      for (const [k, v] of Object.entries(response.headers || {})) {
        if (!skip.has(k.toLowerCase())) res.setHeader(k, v);
      }
      const body = response.body ? Buffer.from(response.body, 'base64') : Buffer.alloc(0);
      res.end(body);
    },
    reject: () => {
      clearTimeout(timer);
      pending.delete(id);
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end('Bad Gateway');
      }
    },
    timer,
  });

  readBody(req).then((body) => {
    sendWs(entry.ws, {
      type: 'req',
      id,
      method: req.method || 'GET',
      path,
      headers,
      body: body.length ? body.toString('base64') : undefined,
    });
  }).catch(() => {
    clearTimeout(timer);
    pending.delete(id);
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
    proxyHttpToTunnel(req, res, subdomain, entry);
  });

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Puerto ${httpPort} en uso (¿frps sigue activo?). Detén frps: docker stop dtunnel_frps`,
      );
    }
    throw err;
  });

  httpServer.listen(httpPort, httpHost, () => {
    console.log(`dtunnel-native HTTP en http://${httpHost}:${httpPort} (*.${domain})`);
  });

  const wss = new WebSocketServer({ noServer: true });

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

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'res' && msg.id && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
      }
      if (msg.type === 'ping') sendWs(ws, { type: 'pong' });
    });

    ws.on('close', () => {
      if (tunnels.get(key)?.ws === ws) tunnels.delete(key);
    });

    sendWs(ws, { type: 'ready', subdomain: key });
  });

  apiServer.on('upgrade', (req, socket, head) => {
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
