import { EventEmitter } from 'events';
import db from './db.js';

const MAX_ROWS = Number(process.env.REQUEST_TRACE_MAX_ROWS || 100_000);
const RETENTION_DAYS = Number(process.env.REQUEST_TRACE_RETENTION_DAYS || 14);

export const traceEmitter = new EventEmitter();
traceEmitter.setMaxListeners(200);

db.exec(`
  CREATE TABLE IF NOT EXISTS request_traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    user_id INTEGER,
    subdomain TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER,
    duration_ms INTEGER,
    bytes_in INTEGER NOT NULL DEFAULT 0,
    bytes_out INTEGER NOT NULL DEFAULT 0,
    client_ip TEXT,
    user_agent TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_request_traces_user ON request_traces(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_traces_sub ON request_traces(subdomain, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_request_traces_created ON request_traces(created_at DESC);
`);

export function publicRequestTrace(row) {
  return {
    id: row.id,
    requestId: row.request_id,
    userId: row.user_id,
    subdomain: row.subdomain,
    method: row.method,
    path: row.path,
    status: row.status,
    durationMs: row.duration_ms,
    bytesIn: row.bytes_in,
    bytesOut: row.bytes_out,
    clientIp: row.client_ip,
    error: row.error,
    createdAt: row.created_at,
  };
}

function trimRequestTraces() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM request_traces').get().c;
  if (count > MAX_ROWS) {
    const excess = count - MAX_ROWS;
    db.prepare(`
      DELETE FROM request_traces WHERE id IN (
        SELECT id FROM request_traces ORDER BY created_at ASC LIMIT ?
      )
    `).run(excess);
  }
  db.prepare(`
    DELETE FROM request_traces WHERE created_at < datetime('now', ?)
  `).run(`-${RETENTION_DAYS} days`);
}

export function recordRequestTrace({
  requestId,
  userId = null,
  subdomain,
  method,
  path,
  status,
  durationMs,
  bytesIn = 0,
  bytesOut = 0,
  clientIp = null,
  userAgent = null,
  error = null,
}) {
  const result = db.prepare(`
    INSERT INTO request_traces (
      request_id, user_id, subdomain, method, path, status, duration_ms,
      bytes_in, bytes_out, client_ip, user_agent, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    requestId,
    userId,
    String(subdomain).toLowerCase(),
    method,
    String(path).slice(0, 2048),
    status,
    durationMs,
    bytesIn,
    bytesOut,
    clientIp,
    userAgent ? String(userAgent).slice(0, 512) : null,
    error,
  );

  const row = db.prepare('SELECT * FROM request_traces WHERE id = ?').get(result.lastInsertRowid);
  const pub = publicRequestTrace(row);
  traceEmitter.emit('trace', pub);
  trimRequestTraces();
  return pub;
}

export function userOwnsSubdomain(userId, subdomain) {
  const name = String(subdomain).toLowerCase();
  const reserved = db.prepare('SELECT 1 FROM reserved_subdomains WHERE user_id = ? AND name = ?').get(userId, name);
  if (reserved) return true;
  const active = db.prepare('SELECT 1 FROM active_tunnels WHERE user_id = ? AND subdomain = ?').get(userId, name);
  return Boolean(active);
}

export function userCanSeeTrace(userId, trace) {
  if (trace.userId === userId) return true;
  return userOwnsSubdomain(userId, trace.subdomain);
}

export function listRequestTraces({
  userId = null,
  subdomain = null,
  limit = 100,
  offset = 0,
} = {}) {
  const params = [];
  const where = [];
  if (userId != null) {
    where.push(`(
      user_id = ?
      OR subdomain IN (SELECT name FROM reserved_subdomains WHERE user_id = ?)
      OR subdomain IN (SELECT subdomain FROM active_tunnels WHERE user_id = ?)
    )`);
    params.push(userId, userId, userId);
  }
  if (subdomain) {
    where.push('subdomain = ?');
    params.push(String(subdomain).toLowerCase());
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = db.prepare(`
    SELECT * FROM request_traces ${clause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM request_traces ${clause}`).get(...params).c;
  return { traces: rows.map(publicRequestTrace), total, limit: safeLimit, offset: safeOffset };
}

export function listRequestTracesAdmin({
  q = null,
  subdomain = null,
  userId = null,
  status = null,
  limit = 100,
  offset = 0,
} = {}) {
  const params = [];
  const where = [];
  if (q) {
    where.push('(rt.path LIKE ? OR rt.subdomain LIKE ? OR rt.client_ip LIKE ? OR rt.request_id LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (subdomain) {
    where.push('rt.subdomain = ?');
    params.push(String(subdomain).toLowerCase());
  }
  if (userId != null) {
    where.push('rt.user_id = ?');
    params.push(userId);
  }
  if (status != null) {
    where.push('rt.status = ?');
    params.push(Number(status));
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = db.prepare(`
    SELECT rt.*, u.email
    FROM request_traces rt
    LEFT JOIN users u ON u.id = rt.user_id
    ${clause}
    ORDER BY rt.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM request_traces rt ${clause}
  `).get(...params).c;
  return {
    traces: rows.map((r) => ({ ...publicRequestTrace(r), email: r.email })),
    total,
    limit: safeLimit,
    offset: safeOffset,
  };
}

export function purgeRequestTracesOlderThan(days = RETENTION_DAYS) {
  return db.prepare(`
    DELETE FROM request_traces WHERE created_at < datetime('now', ?)
  `).run(`-${days} days`).changes;
}

export function getRequestTraceStats(userId = null) {
  if (userId != null) {
    const uid = Number(userId);
    const clause = `WHERE (
      user_id = ? OR subdomain IN (SELECT name FROM reserved_subdomains WHERE user_id = ?)
      OR subdomain IN (SELECT subdomain FROM active_tunnels WHERE user_id = ?)
    )`;
    return {
      lastHour: db.prepare(`SELECT COUNT(*) AS c FROM request_traces ${clause} AND created_at >= datetime('now', '-1 hour')`).get(uid, uid, uid).c,
      last24h: db.prepare(`SELECT COUNT(*) AS c FROM request_traces ${clause} AND created_at >= datetime('now', '-24 hours')`).get(uid, uid, uid).c,
      total: db.prepare(`SELECT COUNT(*) AS c FROM request_traces ${clause}`).get(uid, uid, uid).c,
    };
  }
  return {
    lastHour: db.prepare(`SELECT COUNT(*) AS c FROM request_traces WHERE created_at >= datetime('now', '-1 hour')`).get().c,
    last24h: db.prepare(`SELECT COUNT(*) AS c FROM request_traces WHERE created_at >= datetime('now', '-24 hours')`).get().c,
    total: db.prepare('SELECT COUNT(*) AS c FROM request_traces').get().c,
  };
}
