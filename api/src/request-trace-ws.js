import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { findUserById } from './db.js';
import { listRequestTraces, traceEmitter, userCanSeeTrace } from './request-trace.js';

/**
 * WebSocket de trazas HTTP en tiempo real.
 * wss://host/api/request-logs/ws?token=JWT&subdomain=opcional
 */
export function startRequestTraceWs({ apiServer, jwtSecret, pathPrefix = '/request-logs/ws' }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map();

  function onTrace(trace) {
    for (const [ws, meta] of clients) {
      if (ws.readyState !== 1) continue;
      if (!userCanSeeTrace(meta.userId, trace)) continue;
      if (meta.subdomain && meta.subdomain !== trace.subdomain) continue;
      ws.send(JSON.stringify({ type: 'trace', trace }));
    }
  }

  traceEmitter.on('trace', onTrace);

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'Token requerido');
        return;
      }
      const payload = jwt.verify(token, jwtSecret);
      if (payload.imp) {
        ws.close(4003, 'No disponible en impersonación');
        return;
      }
      const user = findUserById(payload.userId);
      if (!user?.active) {
        ws.close(4003, 'Cuenta inactiva');
        return;
      }
      const subdomain = url.searchParams.get('subdomain')?.toLowerCase() || null;
      clients.set(ws, { userId: user.id, subdomain });

      const recent = listRequestTraces({ userId: user.id, subdomain, limit: 50 });
      ws.send(JSON.stringify({ type: 'history', traces: recent.traces }));

      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    } catch {
      ws.close(4001, 'No autorizado');
    }
  });

  function handleUpgrade(req, socket, head) {
    if (!req.url?.startsWith(pathPrefix)) return false;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
    return true;
  }

  return { wss, handleUpgrade, stop: () => traceEmitter.off('trace', onTrace) };
}
