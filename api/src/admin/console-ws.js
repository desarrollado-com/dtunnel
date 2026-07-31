import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { auditEmitter, listAuditLogs } from '../audit.js';
import { findUserById, getLiveMetrics } from '../db.js';
import {
  listRequestTracesAdmin,
  traceEmitter,
} from '../request-trace.js';

const TICK_MS = 5000;
const MAX_HISTORY = 80;

/**
 * Consola admin en tiempo real: métricas + trazas HTTP + auditoría.
 * wss://host/api/admin/ws/console?token=JWT
 */
export function startAdminConsoleWs({
  jwtSecret,
  adminEmails = [],
  pathPrefix = '/admin/ws/console',
}) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  const metricsHistory = [];

  function isAdminUser(user) {
    if (!user) return false;
    return Boolean(user.is_admin) || adminEmails.includes(String(user.email || '').toLowerCase());
  }

  function pushMetricsHistory(point) {
    metricsHistory.push({
      ts: point.ts,
      activeTunnels: point.stats.activeTunnels,
      anonTunnels: point.stats.anonTunnels,
    });
    while (metricsHistory.length > MAX_HISTORY) metricsHistory.shift();
  }

  function sampleMetrics() {
    const point = getLiveMetrics();
    pushMetricsHistory(point);
    return {
      type: 'metrics',
      ts: point.ts,
      stats: point.stats,
      history: [...metricsHistory],
    };
  }

  function enrichTrace(trace) {
    if (!trace.userId) return { ...trace, email: null };
    const user = findUserById(trace.userId);
    return { ...trace, email: user?.email || null };
  }

  function broadcast(payload) {
    const raw = JSON.stringify(payload);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(raw);
    }
  }

  function onTrace(trace) {
    if (!clients.size) return;
    broadcast({ type: 'trace', trace: enrichTrace(trace) });
  }

  function onAudit(log) {
    if (!clients.size) return;
    broadcast({ type: 'audit', log });
  }

  traceEmitter.on('trace', onTrace);
  auditEmitter.on('audit', onAudit);

  const timer = setInterval(() => {
    if (!clients.size) return;
    broadcast(sampleMetrics());
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

      const { traces } = listRequestTracesAdmin({ limit: 40, offset: 0 });
      const { logs } = listAuditLogs({ limit: 30, offset: 0 });
      const metrics = sampleMetrics();

      ws.send(JSON.stringify({
        type: 'init',
        metrics,
        traces: traces.map((t) => enrichTrace(t)),
        audits: logs,
      }));

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

  return {
    wss,
    handleUpgrade,
    stop: () => {
      clearInterval(timer);
      traceEmitter.off('trace', onTrace);
      auditEmitter.off('audit', onAudit);
    },
  };
}
