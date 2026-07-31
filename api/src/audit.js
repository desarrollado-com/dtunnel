import db from './db.js';
import { EventEmitter } from 'events';

const MAX_LOG_ROWS = 10_000;

export const auditEmitter = new EventEmitter();
auditEmitter.setMaxListeners(100);

function formatAuditRow(r) {
  return {
    id: r.id,
    actorUserId: r.actor_user_id,
    actorEmail: r.actor_email,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    details: r.details ? JSON.parse(r.details) : null,
    ip: r.ip,
    createdAt: r.created_at,
  };
}

export function appendAuditLog({
  actorUserId = null,
  actorEmail = null,
  action,
  targetType = null,
  targetId = null,
  details = null,
  ip = null,
}) {
  if (!action) return;
  const result = db.prepare(`
    INSERT INTO audit_logs (actor_user_id, actor_email, action, target_type, target_id, details, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorUserId,
    actorEmail,
    action,
    targetType,
    targetId != null ? String(targetId) : null,
    details ? JSON.stringify(details) : null,
    ip,
  );
  trimAuditLogs();
  const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(result.lastInsertRowid);
  if (row) {
    auditEmitter.emit('audit', formatAuditRow(row));
  }
}

function trimAuditLogs() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
  if (count <= MAX_LOG_ROWS) return;
  const excess = count - MAX_LOG_ROWS;
  db.prepare(`
    DELETE FROM audit_logs WHERE id IN (
      SELECT id FROM audit_logs ORDER BY created_at ASC LIMIT ?
    )
  `).run(excess);
}

export function listAuditLogs({ limit = 100, offset = 0, action = null, q = null } = {}) {
  const params = [];
  const where = [];
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (q) {
    where.push('(actor_email LIKE ? OR target_id LIKE ? OR details LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT id, actor_user_id, actor_email, action, target_type, target_id, details, ip, created_at
    FROM audit_logs
    ${clause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`).get(...params).c;
  return {
    logs: rows.map((r) => formatAuditRow(r)),
    total,
  };
}

export function purgeAuditLogsOlderThan(days = 30) {
  const result = db.prepare(`
    DELETE FROM audit_logs WHERE created_at < datetime('now', ?)
  `).run(`-${days} days`);
  return result.changes;
}
