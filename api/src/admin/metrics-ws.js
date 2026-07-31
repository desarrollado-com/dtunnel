import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { findUserById, getLiveMetrics } from '../db.js';

const MAX_HISTORY = 120;
const TICK_MS = 5000;

/**
 * WebSocket de métricas en tiempo real para el panel admin.
 * Conexión: wss://host/api/admin/ws/metrics?token=JWT
 */
export function startAdminMetricsWs({ apiServer, jwtSecret, adminEmails = [], pathPrefix = '/admin/ws/metrics' }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  const history = [];

  function isAdminUser(user) {
    if (!user) return false;
    return Boolean(user.is_admin) || adminEmails.includes(String(user.email || '').toLowerCase());
  }

  function pushHistory(point) {
    history.push(point);
    while (history.length > MAX_HISTORY) history.shift();
  }

  function sample() {
    const point = getLiveMetrics();
    pushHistory({
      ts: point.ts,
      activeTunnels: point.stats.activeTunnels,
      anonTunnels: point.stats.anonTunnels,
      users: point.stats.users,
      auditLastHour: point.stats.auditLastHour,
      signupsLastHour: point.stats.signupsLastHour,
      tunnelOpensLastHour: point.stats.tunnelOpensLastHour,
    });
    return { type: 'metrics', ...point, history: [...history] };
  }

  function broadcast(payload) {
    const raw = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  const timer = setInterval(() => {
    if (!clients.size) return;
    broadcast(sample());
  }, TICK_MS);

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
      if (!isAdminUser(user)) {
        ws.close(4003, 'Admin requerido');
        return;
      }
      clients.add(ws);
      ws.send(JSON.stringify(sample()));
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

  return { wss, handleUpgrade, stop: () => clearInterval(timer) };
}
