import db from '../db.js';
import { getDefaultRemediation } from './scanner.js';

function publicBlacklistRow(r) {
  return {
    id: r.id,
    ip: r.ip,
    reason: r.reason,
    remediation: r.remediation,
    scope: r.scope,
    source: r.source,
    createdBy: r.created_by,
    expiresAt: r.expires_at,
    active: Boolean(r.active),
    createdAt: r.created_at,
  };
}

function publicWhitelistRow(r) {
  return {
    id: r.id,
    ip: r.ip,
    label: r.label,
    bypassRateLimit: Boolean(r.bypass_rate_limit),
    bypassAnonLimit: Boolean(r.bypass_anon_limit),
    bypassBlacklist: Boolean(r.bypass_blacklist),
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function publicAbuseRow(r) {
  let details = null;
  try {
    details = r.details ? JSON.parse(r.details) : null;
  } catch {
    details = r.details;
  }
  return {
    id: r.id,
    eventType: r.event_type,
    severity: r.severity,
    ip: r.ip,
    userId: r.user_id,
    subdomain: r.subdomain,
    fingerprintHash: r.fingerprint_hash,
    userAgent: r.user_agent,
    details,
    actionTaken: r.action_taken,
    blocked: Boolean(r.blocked),
    createdAt: r.created_at,
  };
}

function publicDeviceRow(r) {
  return {
    id: r.id,
    fingerprintHash: r.fingerprint_hash,
    userId: r.user_id,
    clientIp: r.client_ip,
    userAgent: r.user_agent,
    clientVersion: r.client_version,
    clientId: r.client_id,
    tunnelCount: r.tunnel_count,
    abuseCount: r.abuse_count,
    blocked: Boolean(r.blocked),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

export function isIpWhitelisted(ip) {
  if (!ip) return false;
  return Boolean(db.prepare('SELECT 1 FROM ip_whitelist WHERE ip = ?').get(ip));
}

export function getWhitelistEntry(ip) {
  if (!ip) return null;
  const row = db.prepare('SELECT * FROM ip_whitelist WHERE ip = ?').get(ip);
  return row ? publicWhitelistRow(row) : null;
}

export function isIpBlacklisted(ip, scope = 'all') {
  if (!ip) return null;
  const wl = db.prepare('SELECT * FROM ip_whitelist WHERE ip = ?').get(ip);
  if (wl?.bypass_blacklist) return null;
  const row = db.prepare(`
    SELECT * FROM ip_blacklist
    WHERE ip = ? AND active = 1
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND (scope = 'all' OR scope = ?)
    ORDER BY CASE scope WHEN 'all' THEN 0 ELSE 1 END
    LIMIT 1
  `).get(ip, scope);
  return row ? publicBlacklistRow(row) : null;
}

export function listIpBlacklist({ limit = 50, offset = 0, q = '' } = {}) {
  const params = [];
  let where = 'WHERE active = 1';
  if (q) {
    where += ' AND (ip LIKE ? OR reason LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM ip_blacklist ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT * FROM ip_blacklist ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return { total, entries: rows.map(publicBlacklistRow) };
}

export function addIpBlacklist({
  ip,
  reason,
  remediation = null,
  scope = 'all',
  source = 'manual',
  createdBy = null,
  expiresAt = null,
}) {
  const existing = db.prepare('SELECT id FROM ip_blacklist WHERE ip = ? AND scope = ?').get(ip, scope);
  if (existing) {
    db.prepare(`
      UPDATE ip_blacklist SET
        reason = ?, remediation = ?, source = ?, created_by = ?,
        expires_at = ?, active = 1, created_at = datetime('now')
      WHERE id = ?
    `).run(reason, remediation || getDefaultRemediation(), source, createdBy, expiresAt, existing.id);
    return publicBlacklistRow(db.prepare('SELECT * FROM ip_blacklist WHERE id = ?').get(existing.id));
  }
  const result = db.prepare(`
    INSERT INTO ip_blacklist (ip, reason, remediation, scope, source, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(ip, reason, remediation || getDefaultRemediation(), scope, source, createdBy, expiresAt);
  return publicBlacklistRow(db.prepare('SELECT * FROM ip_blacklist WHERE id = ?').get(result.lastInsertRowid));
}

export function removeIpBlacklist(id) {
  const result = db.prepare('UPDATE ip_blacklist SET active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

export function listIpWhitelist({ limit = 50, offset = 0 } = {}) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM ip_whitelist').get().c;
  const rows = db.prepare(`
    SELECT * FROM ip_whitelist ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
  return { total, entries: rows.map(publicWhitelistRow) };
}

export function addIpWhitelist({
  ip,
  label = null,
  bypassRateLimit = true,
  bypassAnonLimit = false,
  bypassBlacklist = false,
  createdBy = null,
}) {
  const existing = db.prepare('SELECT id FROM ip_whitelist WHERE ip = ?').get(ip);
  if (existing) {
    db.prepare(`
      UPDATE ip_whitelist SET
        label = ?, bypass_rate_limit = ?, bypass_anon_limit = ?,
        bypass_blacklist = ?, created_by = ?
      WHERE id = ?
    `).run(label, bypassRateLimit ? 1 : 0, bypassAnonLimit ? 1 : 0, bypassBlacklist ? 1 : 0, createdBy, existing.id);
    return publicWhitelistRow(db.prepare('SELECT * FROM ip_whitelist WHERE id = ?').get(existing.id));
  }
  const result = db.prepare(`
    INSERT INTO ip_whitelist (ip, label, bypass_rate_limit, bypass_anon_limit, bypass_blacklist, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ip, label, bypassRateLimit ? 1 : 0, bypassAnonLimit ? 1 : 0, bypassBlacklist ? 1 : 0, createdBy);
  return publicWhitelistRow(db.prepare('SELECT * FROM ip_whitelist WHERE id = ?').get(result.lastInsertRowid));
}

export function removeIpWhitelist(id) {
  return db.prepare('DELETE FROM ip_whitelist WHERE id = ?').run(id).changes > 0;
}

export function recordAbuseEvent({
  eventType,
  severity = 'medium',
  ip = null,
  userId = null,
  subdomain = null,
  fingerprintHash = null,
  userAgent = null,
  details = null,
  actionTaken = 'logged',
  blocked = false,
}) {
  const result = db.prepare(`
    INSERT INTO abuse_events (
      event_type, severity, ip, user_id, subdomain, fingerprint_hash, user_agent, details, action_taken, blocked
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventType,
    severity,
    ip,
    userId,
    subdomain,
    fingerprintHash,
    userAgent,
    details ? JSON.stringify(details) : null,
    actionTaken,
    blocked ? 1 : 0,
  );
  trimAbuseEvents();
  return publicAbuseRow(db.prepare('SELECT * FROM abuse_events WHERE id = ?').get(result.lastInsertRowid));
}

function trimAbuseEvents() {
  const max = Number(process.env.ABUSE_EVENTS_MAX_ROWS || 50_000);
  const count = db.prepare('SELECT COUNT(*) AS c FROM abuse_events').get().c;
  if (count <= max) return;
  db.prepare(`
    DELETE FROM abuse_events WHERE id IN (
      SELECT id FROM abuse_events ORDER BY created_at ASC LIMIT ?
    )
  `).run(count - max);
}

export function countAbuseEventsForIp(ip, withinSeconds = 3600) {
  if (!ip) return 0;
  return db.prepare(`
    SELECT COUNT(*) AS c FROM abuse_events
    WHERE ip = ? AND created_at >= datetime('now', ?)
  `).get(ip, `-${withinSeconds} seconds`).c;
}

export function listAbuseEvents({ limit = 50, offset = 0, severity = '', eventType = '', ip = '' } = {}) {
  const params = [];
  const clauses = [];
  if (severity) { clauses.push('severity = ?'); params.push(severity); }
  if (eventType) { clauses.push('event_type = ?'); params.push(eventType); }
  if (ip) { clauses.push('ip LIKE ?'); params.push(`%${ip}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM abuse_events ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT * FROM abuse_events ${where}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return { total, events: rows.map(publicAbuseRow) };
}

export function touchDeviceFingerprint({
  fingerprintHash,
  userId = null,
  clientIp = null,
  userAgent = null,
  clientVersion = null,
  clientId = null,
}) {
  if (!fingerprintHash) return null;
  const existing = db.prepare(`
    SELECT * FROM device_fingerprints WHERE fingerprint_hash = ? AND (user_id IS ? OR user_id = ?)
  `).get(fingerprintHash, userId, userId);
  if (existing) {
    db.prepare(`
      UPDATE device_fingerprints SET
        last_seen_at = datetime('now'),
        tunnel_count = tunnel_count + 1,
        client_ip = COALESCE(?, client_ip),
        user_agent = COALESCE(?, user_agent),
        client_version = COALESCE(?, client_version),
        client_id = COALESCE(?, client_id)
      WHERE id = ?
    `).run(clientIp, userAgent, clientVersion, clientId, existing.id);
    return publicDeviceRow(db.prepare('SELECT * FROM device_fingerprints WHERE id = ?').get(existing.id));
  }
  const result = db.prepare(`
    INSERT INTO device_fingerprints (
      fingerprint_hash, user_id, client_ip, user_agent, client_version, client_id, tunnel_count
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(fingerprintHash, userId, clientIp, userAgent, clientVersion, clientId);
  return publicDeviceRow(db.prepare('SELECT * FROM device_fingerprints WHERE id = ?').get(result.lastInsertRowid));
}

export function listDeviceFingerprints({ limit = 50, offset = 0, q = '' } = {}) {
  const params = [];
  let where = '';
  if (q) {
    where = 'WHERE d.fingerprint_hash LIKE ? OR d.client_ip LIKE ? OR d.user_agent LIKE ? OR d.client_id LIKE ?';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM device_fingerprints d ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT d.*, u.email
    FROM device_fingerprints d
    LEFT JOIN users u ON u.id = d.user_id
    ${where}
    ORDER BY d.last_seen_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return {
    total,
    devices: rows.map((r) => ({ ...publicDeviceRow(r), email: r.email || null })),
  };
}

export function setDeviceBlocked(fingerprintHash, blocked = true) {
  const result = db.prepare('UPDATE device_fingerprints SET blocked = ? WHERE fingerprint_hash = ?')
    .run(blocked ? 1 : 0, fingerprintHash);
  return result.changes > 0;
}

export function isDeviceBlocked(fingerprintHash) {
  if (!fingerprintHash) return false;
  const row = db.prepare('SELECT blocked FROM device_fingerprints WHERE fingerprint_hash = ? LIMIT 1')
    .get(fingerprintHash);
  return Boolean(row?.blocked);
}

export function maybeAutoBlockIp(ip, { eventType, severity, createdBy = null } = {}) {
  if (!ip || isIpWhitelisted(ip)) return null;
  const recent = countAbuseEventsForIp(ip, 3600);
  const shouldBlock = severity === 'critical' || recent >= 3;
  if (!shouldBlock) return null;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return addIpBlacklist({
    ip,
    reason: `Bloqueo automático: ${eventType} (${severity})`,
    source: 'auto',
    createdBy,
    expiresAt,
    scope: 'all',
  });
}

export function getSecurityOverview() {
  const stats = {
    blacklistedIps: db.prepare(`
      SELECT COUNT(*) AS c FROM ip_blacklist
      WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get().c,
    whitelistedIps: db.prepare('SELECT COUNT(*) AS c FROM ip_whitelist').get().c,
    abuseLast24h: db.prepare(`
      SELECT COUNT(*) AS c FROM abuse_events WHERE created_at >= datetime('now', '-1 day')
    `).get().c,
    criticalLast24h: db.prepare(`
      SELECT COUNT(*) AS c FROM abuse_events
      WHERE severity = 'critical' AND created_at >= datetime('now', '-1 day')
    `).get().c,
    blockedDevices: db.prepare('SELECT COUNT(*) AS c FROM device_fingerprints WHERE blocked = 1').get().c,
    trackedDevices: db.prepare('SELECT COUNT(*) AS c FROM device_fingerprints').get().c,
  };
  const recentThreats = listAbuseEvents({ limit: 15, offset: 0 }).events;
  return { stats, recentThreats };
}

export function listTunnelCreatorsSecurity() {
  const rows = db.prepare(`
    SELECT
      at.id, at.user_id, at.subdomain, at.port, at.client_ip, at.user_agent,
      at.client_version, at.fingerprint_hash, at.last_heartbeat, at.created_at,
      u.email,
      (SELECT COUNT(*) FROM abuse_events ae WHERE ae.ip = at.client_ip AND ae.created_at >= datetime('now', '-7 day')) AS abuse_ip_7d,
      (SELECT COUNT(*) FROM abuse_events ae WHERE ae.fingerprint_hash = at.fingerprint_hash AND ae.created_at >= datetime('now', '-7 day')) AS abuse_fp_7d
    FROM active_tunnels at
    LEFT JOIN users u ON u.id = at.user_id
    ORDER BY at.created_at DESC
  `).all();
  return rows.map((r) => {
    const blacklist = r.client_ip ? isIpBlacklisted(r.client_ip) : null;
    const whitelist = r.client_ip ? getWhitelistEntry(r.client_ip) : null;
    const deviceBlocked = r.fingerprint_hash ? isDeviceBlocked(r.fingerprint_hash) : false;
    return {
      tunnelId: r.id,
      userId: r.user_id,
      email: r.email,
      subdomain: r.subdomain,
      port: r.port,
      clientIp: r.client_ip,
      userAgent: r.user_agent,
      clientVersion: r.client_version,
      fingerprintHash: r.fingerprint_hash,
      lastHeartbeat: r.last_heartbeat,
      createdAt: r.created_at,
      abuseIp7d: r.abuse_ip_7d,
      abuseFp7d: r.abuse_fp_7d,
      blacklist,
      whitelist,
      deviceBlocked,
      risk: blacklist ? 'blocked' : (r.abuse_ip_7d >= 3 || deviceBlocked ? 'high' : r.abuse_ip_7d > 0 ? 'medium' : 'low'),
    };
  });
}
