import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { applySchemaExtensions, parsePlanFeatures, stringifyPlanFeatures } from './schema-extensions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'dtunnel.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    is_admin INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    tunnel_limit_override INTEGER,
    reserved_subdomain_limit_override INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    price_monthly REAL NOT NULL DEFAULT 0,
    price_yearly REAL,
    currency TEXT NOT NULL DEFAULT 'USD',
    tunnel_limit INTEGER NOT NULL DEFAULT 5,
    reserved_subdomain_limit INTEGER NOT NULL DEFAULT 5,
    custom_subdomain INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reserved_subdomains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS active_tunnels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    subdomain TEXT NOT NULL,
    port INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    actor_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    ip TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
`);

function migrateColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

migrateColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
migrateColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
migrateColumn('users', 'tunnel_limit_override', 'INTEGER');
migrateColumn('users', 'reserved_subdomain_limit_override', 'INTEGER');
migrateColumn('active_tunnels', 'client_ip', 'TEXT');
migrateColumn('active_tunnels', 'last_heartbeat', 'TEXT');
migrateColumn('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
const emailVerificationMigrated = db.prepare(
  "SELECT value FROM settings WHERE key = 'email_verification_migrated'",
).get();
if (!emailVerificationMigrated) {
  db.prepare('UPDATE users SET email_verified = 1').run();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES ('email_verification_migrated', '1', datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run();
}

const DEFAULT_PLANS = [
  {
    slug: 'free',
    name: 'Gratis',
    description: 'Cuenta registrada sin costo',
    price_monthly: 0,
    price_yearly: 0,
    tunnel_limit: 5,
    reserved_subdomain_limit: 5,
    custom_subdomain: 1,
    sort_order: 0,
  },
  {
    slug: 'pro',
    name: 'Pro',
    description: 'Más túneles y subdominios',
    price_monthly: 9.99,
    price_yearly: 99,
    tunnel_limit: 20,
    reserved_subdomain_limit: 20,
    custom_subdomain: 1,
    sort_order: 1,
  },
];

function seedPlans() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO plans (
      slug, name, description, price_monthly, price_yearly, currency,
      tunnel_limit, reserved_subdomain_limit, custom_subdomain, sort_order, active
    ) VALUES (
      @slug, @name, @description, @price_monthly, @price_yearly, 'USD',
      @tunnel_limit, @reserved_subdomain_limit, @custom_subdomain, @sort_order, 1
    )
  `);
  for (const plan of DEFAULT_PLANS) {
    insert.run(plan);
  }
}

seedPlans();
applySchemaExtensions(db);

export function syncAdminUsers(adminEmails = []) {
  db.prepare('UPDATE users SET is_admin = 0').run();
  if (!adminEmails.length) return;
  const stmt = db.prepare('UPDATE users SET is_admin = 1, email_verified = 1 WHERE email = ?');
  for (const email of adminEmails) {
    stmt.run(email.toLowerCase().trim());
  }
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, String(value));
}

export function getAnonTunnelLimit(fallback = 1) {
  const stored = getSetting('anon_tunnel_limit');
  return stored != null ? Number(stored) : fallback;
}

export function createUser(email, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (email, password_hash, plan) VALUES (?, ?, ?)');
  return stmt.run(email.toLowerCase().trim(), hash, 'free');
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

export function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

export function getPlanBySlug(slug) {
  return db.prepare('SELECT * FROM plans WHERE slug = ? AND active = 1').get(slug);
}

export function listPlans(includeInactive = false, { publicOnly = false } = {}) {
  const clauses = [];
  if (!includeInactive) clauses.push('active = 1');
  if (publicOnly) clauses.push("visibility = 'public'");
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM plans ${where} ORDER BY sort_order, id`).all();
}

export function createPlan(data) {
  const features = data.features != null
    ? (typeof data.features === 'string' ? data.features : stringifyPlanFeatures(data.features))
    : stringifyPlanFeatures({});
  const stmt = db.prepare(`
    INSERT INTO plans (
      slug, name, description, price_monthly, price_yearly, currency,
      tunnel_limit, reserved_subdomain_limit, custom_subdomain, sort_order, active,
      plan_type, visibility, max_seats, features, wompi_product_id
    ) VALUES (
      @slug, @name, @description, @price_monthly, @price_yearly, @currency,
      @tunnel_limit, @reserved_subdomain_limit, @custom_subdomain, @sort_order, @active,
      @plan_type, @visibility, @max_seats, @features, @wompi_product_id
    )
  `);
  return stmt.run({
    slug: data.slug,
    name: data.name,
    description: data.description || '',
    price_monthly: Number(data.price_monthly || 0),
    price_yearly: data.price_yearly != null ? Number(data.price_yearly) : null,
    currency: data.currency || 'USD',
    tunnel_limit: Number(data.tunnel_limit || 1),
    reserved_subdomain_limit: Number(data.reserved_subdomain_limit || 0),
    custom_subdomain: data.custom_subdomain ? 1 : 0,
    sort_order: Number(data.sort_order || 0),
    active: data.active === false ? 0 : 1,
    plan_type: data.plan_type || data.planType || 'personal',
    visibility: data.visibility || 'public',
    max_seats: Number(data.max_seats ?? data.maxSeats ?? 1),
    features,
    wompi_product_id: data.wompi_product_id || data.wompiProductId || null,
  });
}

export function updatePlan(id, data) {
  const existing = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!existing) return null;
  const merged = {
    slug: data.slug ?? existing.slug,
    name: data.name ?? existing.name,
    description: data.description ?? existing.description,
    price_monthly: data.price_monthly != null ? Number(data.price_monthly) : existing.price_monthly,
    price_yearly: data.price_yearly != null ? Number(data.price_yearly) : existing.price_yearly,
    currency: data.currency ?? existing.currency,
    tunnel_limit: data.tunnel_limit != null ? Number(data.tunnel_limit) : existing.tunnel_limit,
    reserved_subdomain_limit: data.reserved_subdomain_limit != null
      ? Number(data.reserved_subdomain_limit)
      : existing.reserved_subdomain_limit,
    custom_subdomain: data.custom_subdomain != null ? (data.custom_subdomain ? 1 : 0) : existing.custom_subdomain,
    sort_order: data.sort_order != null ? Number(data.sort_order) : existing.sort_order,
    active: data.active != null ? (data.active ? 1 : 0) : existing.active,
    plan_type: data.plan_type ?? data.planType ?? existing.plan_type ?? 'personal',
    visibility: data.visibility ?? existing.visibility ?? 'public',
    max_seats: data.max_seats != null ? Number(data.max_seats) : (data.maxSeats != null ? Number(data.maxSeats) : (existing.max_seats ?? 1)),
    features: data.features != null
      ? (typeof data.features === 'string' ? data.features : stringifyPlanFeatures(data.features))
      : existing.features,
    wompi_product_id: data.wompi_product_id ?? data.wompiProductId ?? existing.wompi_product_id,
    id,
  };
  db.prepare(`
    UPDATE plans SET
      slug = @slug, name = @name, description = @description,
      price_monthly = @price_monthly, price_yearly = @price_yearly, currency = @currency,
      tunnel_limit = @tunnel_limit, reserved_subdomain_limit = @reserved_subdomain_limit,
      custom_subdomain = @custom_subdomain, sort_order = @sort_order, active = @active,
      plan_type = @plan_type, visibility = @visibility, max_seats = @max_seats,
      features = @features, wompi_product_id = @wompi_product_id,
      updated_at = datetime('now')
    WHERE id = @id
  `).run(merged);
  return db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
}

export function getUserLimits(user, anonFallback = 1) {
  if (!user) {
    return {
      tunnelLimit: getAnonTunnelLimit(anonFallback),
      reservedSubdomainLimit: 0,
      customSubdomain: false,
      customCname: false,
      customCnameLimit: 0,
      plan: null,
      features: {},
    };
  }

  let planSlug = user.plan || 'free';
  let plan = getPlanBySlug(planSlug) || getPlanBySlug('free');

  if (user.primary_org_id) {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ? AND active = 1').get(user.primary_org_id);
    if (org) {
      const orgPlan = getPlanBySlug(org.plan);
      if (orgPlan?.plan_type === 'enterprise') {
        plan = orgPlan;
        planSlug = org.plan;
      }
    }
  }

  const features = parsePlanFeatures(plan?.features);
  return {
    tunnelLimit: user.tunnel_limit_override ?? plan?.tunnel_limit ?? 5,
    reservedSubdomainLimit: user.reserved_subdomain_limit_override ?? plan?.reserved_subdomain_limit ?? 5,
    customSubdomain: Boolean(plan?.custom_subdomain) && features.customSubdomain !== false,
    customCname: Boolean(features.customCname),
    customCnameLimit: Number(features.customCnameLimit || 0),
    plan: plan?.slug || planSlug,
    planName: plan?.name || planSlug,
    planType: plan?.plan_type || 'personal',
    maxSeats: plan?.max_seats ?? 1,
    features,
    organizationId: user.primary_org_id || null,
  };
}

export function reserveSubdomain(userId, name) {
  const user = findUserById(userId);
  if (!user || !user.active) throw new Error('Usuario inactivo');
  const limits = getUserLimits(user);
  const count = db.prepare('SELECT COUNT(*) AS c FROM reserved_subdomains WHERE user_id = ?').get(userId).c;
  if (count >= limits.reservedSubdomainLimit) {
    throw new Error(`Límite de subdominios reservados alcanzado (${limits.reservedSubdomainLimit})`);
  }

  const clean = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (clean.length < 3 || clean.length > 32) {
    throw new Error('Subdominio inválido (3-32 caracteres alfanuméricos)');
  }
  const reserved = ['www', 'api', 'mail', 'ftp', 'admin', 'dtunnel'];
  if (reserved.includes(clean)) throw new Error('Subdominio reservado');
  const stmt = db.prepare('INSERT INTO reserved_subdomains (user_id, name) VALUES (?, ?)');
  return stmt.run(userId, clean);
}

export function getReservedSubdomain(name) {
  return db.prepare('SELECT * FROM reserved_subdomains WHERE name = ?').get(name.toLowerCase());
}

export function getUserSubdomains(userId) {
  return db.prepare('SELECT name FROM reserved_subdomains WHERE user_id = ?').all(userId);
}

export function releaseSubdomain(userId, name) {
  const clean = String(name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const row = db.prepare(
    'SELECT id FROM reserved_subdomains WHERE name = ? AND user_id = ?',
  ).get(clean, userId);
  if (!row) return { released: false };
  db.prepare('DELETE FROM reserved_subdomains WHERE id = ?').run(row.id);
  return { released: true, name: clean };
}

export function createPasswordResetToken(userId) {
  const raw = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(userId);
  db.prepare(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+1 hour'))
  `).run(userId, hash);
  return raw;
}

export function findUserByResetToken(rawToken) {
  const hash = createHash('sha256').update(String(rawToken)).digest('hex');
  return db.prepare(`
    SELECT t.user_id, u.email
    FROM password_reset_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.expires_at > datetime('now')
  `).get(hash);
}

export function consumePasswordResetToken(rawToken) {
  const hash = createHash('sha256').update(String(rawToken)).digest('hex');
  db.prepare('DELETE FROM password_reset_tokens WHERE token_hash = ?').run(hash);
}

export function createEmailVerificationToken(userId) {
  const raw = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(userId);
  db.prepare(`
    INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
    VALUES (?, ?, datetime('now', '+48 hours'))
  `).run(userId, hash);
  return raw;
}

export function findUserByVerificationToken(rawToken) {
  const hash = createHash('sha256').update(String(rawToken)).digest('hex');
  return db.prepare(`
    SELECT t.user_id, u.email
    FROM email_verification_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.expires_at > datetime('now')
  `).get(hash);
}

export function consumeEmailVerificationToken(rawToken) {
  const hash = createHash('sha256').update(String(rawToken)).digest('hex');
  db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(hash);
}

export function markEmailVerified(userId) {
  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(userId);
}

export function updateUserPassword(userId, password) {
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
}

export function countActiveTunnels(userId) {
  if (userId == null) {
    return db.prepare('SELECT COUNT(*) AS c FROM active_tunnels WHERE user_id IS NULL').get().c;
  }
  return db.prepare('SELECT COUNT(*) AS c FROM active_tunnels WHERE user_id = ?').get(userId).c;
}

export function countAnonymousTunnelsForIp(clientIp) {
  if (!clientIp) return countActiveTunnels(null);
  return db.prepare(
    'SELECT COUNT(*) AS c FROM active_tunnels WHERE user_id IS NULL AND client_ip = ?',
  ).get(clientIp).c;
}

export function registerTunnel(userId, subdomain, port, meta = {}) {
  const {
    clientIp = null,
    userAgent = null,
    clientVersion = null,
    fingerprintHash = null,
  } = meta;
  const stmt = db.prepare(`
    INSERT INTO active_tunnels (
      user_id, subdomain, port, client_ip, user_agent, client_version, fingerprint_hash, last_heartbeat
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  return stmt.run(
    userId ?? null,
    subdomain,
    port,
    clientIp,
    userAgent,
    clientVersion,
    fingerprintHash,
  );
}

export function findTunnelBySubdomain(subdomain) {
  return db.prepare('SELECT * FROM active_tunnels WHERE subdomain = ?').get(String(subdomain).toLowerCase());
}

export function releaseAllUserTunnels(userId) {
  const rows = db.prepare('SELECT subdomain FROM active_tunnels WHERE user_id = ?').all(userId);
  const result = db.prepare('DELETE FROM active_tunnels WHERE user_id = ?').run(userId);
  return { changes: result.changes, subdomains: rows.map((r) => r.subdomain) };
}

export function releaseTunnel(subdomain, userId = undefined) {
  const row = findTunnelBySubdomain(subdomain);
  if (!row) return { released: false };
  if (row.user_id != null) {
    if (userId == null || row.user_id !== userId) {
      const err = new Error('No autorizado para cerrar este túnel');
      err.code = 'FORBIDDEN';
      throw err;
    }
  }
  deleteTunnel(row.id);
  return { released: true, id: row.id };
}

export function releaseAllAnonymousTunnels() {
  const result = db.prepare('DELETE FROM active_tunnels WHERE user_id IS NULL').run();
  return result.changes;
}

export function releaseAnonymousTunnelsByIp(clientIp) {
  if (!clientIp) return 0;
  const result = db.prepare(
    'DELETE FROM active_tunnels WHERE user_id IS NULL AND client_ip = ?',
  ).run(clientIp);
  return result.changes;
}

export function touchTunnelHeartbeat(subdomain) {
  const result = db.prepare(`
    UPDATE active_tunnels SET last_heartbeat = datetime('now') WHERE subdomain = ?
  `).run(String(subdomain).toLowerCase());
  return result.changes > 0;
}

export function cleanupStaleTunnels(heartbeatMinutes = 10, maxAgeHours = 24) {
  const staleHeartbeat = db.prepare(`
    DELETE FROM active_tunnels
    WHERE last_heartbeat IS NOT NULL
      AND last_heartbeat < datetime('now', ?)
  `).run(`-${heartbeatMinutes} minutes`);

  const staleAge = db.prepare(`
    DELETE FROM active_tunnels
    WHERE (last_heartbeat IS NULL OR last_heartbeat = '')
      AND created_at < datetime('now', ?)
  `).run(`-${maxAgeHours} hours`);

  return staleHeartbeat.changes + staleAge.changes;
}

export function subdomainTaken(subdomain) {
  return db.prepare('SELECT id FROM active_tunnels WHERE subdomain = ?').get(subdomain);
}

function userListSelectClause() {
  return `
    SELECT
      u.id, u.email, u.plan, u.is_admin, u.active, u.email_verified,
      u.tunnel_limit_override, u.reserved_subdomain_limit_override, u.created_at,
      (SELECT COUNT(*) FROM reserved_subdomains rs WHERE rs.user_id = u.id) AS reserved_count,
      (SELECT COUNT(*) FROM active_tunnels at WHERE at.user_id = u.id) AS active_tunnel_count
    FROM users u
  `;
}

export function listUsers() {
  return db.prepare(`${userListSelectClause()} ORDER BY u.created_at DESC`).all();
}

export function listUsersPaginated({
  q = null,
  plan = null,
  active = null,
  limit = 25,
  offset = 0,
} = {}) {
  const params = [];
  const where = [];
  if (q) {
    where.push('u.email LIKE ?');
    params.push(`%${String(q).trim()}%`);
  }
  if (plan) {
    where.push('u.plan = ?');
    params.push(plan);
  }
  if (active !== null && active !== undefined && active !== '') {
    where.push('u.active = ?');
    params.push(active ? 1 : 0);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const users = db.prepare(`
    ${userListSelectClause()}
    ${clause}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM users u ${clause}`).get(...params).c;
  return { users, total, limit: safeLimit, offset: safeOffset };
}

export function updateUser(id, data) {
  const user = findUserById(id);
  if (!user) return null;
  const merged = {
    plan: data.plan ?? user.plan,
    is_admin: data.is_admin != null ? (data.is_admin ? 1 : 0) : user.is_admin,
    active: data.active != null ? (data.active ? 1 : 0) : user.active,
    email_verified: data.email_verified != null
      ? (data.email_verified ? 1 : 0)
      : user.email_verified,
    tunnel_limit_override: data.tunnel_limit_override === null
      ? null
      : (data.tunnel_limit_override != null ? Number(data.tunnel_limit_override) : user.tunnel_limit_override),
    reserved_subdomain_limit_override: data.reserved_subdomain_limit_override === null
      ? null
      : (data.reserved_subdomain_limit_override != null
        ? Number(data.reserved_subdomain_limit_override)
        : user.reserved_subdomain_limit_override),
    id,
  };
  db.prepare(`
    UPDATE users SET
      plan = @plan,
      is_admin = @is_admin,
      active = @active,
      email_verified = @email_verified,
      tunnel_limit_override = @tunnel_limit_override,
      reserved_subdomain_limit_override = @reserved_subdomain_limit_override
    WHERE id = @id
  `).run(merged);
  return findUserById(id);
}

export function listUserTunnels(userId) {
  return db.prepare(`
    SELECT id, subdomain, port, created_at
    FROM active_tunnels
    WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(userId);
}

export function listActiveTunnels() {
  return db.prepare(`
    SELECT
      at.id, at.user_id, at.subdomain, at.port, at.client_ip, at.user_agent,
      at.client_version, at.fingerprint_hash, at.last_heartbeat, at.created_at,
      u.email
    FROM active_tunnels at
    LEFT JOIN users u ON u.id = at.user_id
    ORDER BY at.created_at DESC
  `).all();
}

export function listAnonymousTunnels() {
  return db.prepare(`
    SELECT id, subdomain, port, client_ip, last_heartbeat, created_at
    FROM active_tunnels
    WHERE user_id IS NULL
    ORDER BY client_ip, created_at DESC
  `).all();
}

export function closeAnonymousTunnelsByIp(clientIp) {
  if (!clientIp) return { closed: 0, subdomains: [] };
  const rows = db.prepare(
    'SELECT id, subdomain FROM active_tunnels WHERE user_id IS NULL AND client_ip = ?',
  ).all(clientIp);
  for (const row of rows) {
    deleteTunnel(row.id);
  }
  return { closed: rows.length, subdomains: rows.map((r) => r.subdomain) };
}

export function findTunnelById(id) {
  return db.prepare('SELECT * FROM active_tunnels WHERE id = ?').get(id);
}

export function deleteTunnel(id) {
  return db.prepare('DELETE FROM active_tunnels WHERE id = ?').run(id);
}

export function getAdminStats() {
  return {
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    activeUsers: db.prepare('SELECT COUNT(*) AS c FROM users WHERE active = 1').get().c,
    plans: db.prepare('SELECT COUNT(*) AS c FROM plans WHERE active = 1').get().c,
    reservedSubdomains: db.prepare('SELECT COUNT(*) AS c FROM reserved_subdomains').get().c,
    activeTunnels: db.prepare('SELECT COUNT(*) AS c FROM active_tunnels').get().c,
    anonTunnels: db.prepare('SELECT COUNT(*) AS c FROM active_tunnels WHERE user_id IS NULL').get().c,
  };
}

export function getAdminHealthMeta() {
  const stats = getAdminStats();
  return {
    ...stats,
    auditLogCount: db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c,
    usersUnverified: db.prepare('SELECT COUNT(*) AS c FROM users WHERE email_verified = 0').get().c,
    usersSuspended: stats.users - stats.activeUsers,
    admins: db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c,
  };
}

export function getAdminAnalytics(days = 14) {
  const safeDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const since = `-${safeDays} days`;

  const signups = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM users
    WHERE created_at >= datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY day
  `).all(since);

  const tunnelOpens = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM audit_logs
    WHERE action = 'tunnel.open' AND created_at >= datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY day
  `).all(since);

  const tunnelCloses = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM audit_logs
    WHERE action = 'tunnel.close' AND created_at >= datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY day
  `).all(since);

  const planDistribution = db.prepare(`
    SELECT plan, COUNT(*) AS count FROM users GROUP BY plan ORDER BY count DESC
  `).all();

  const recentActions = db.prepare(`
    SELECT action, COUNT(*) AS count
    FROM audit_logs
    WHERE created_at >= datetime('now', '-24 hours')
    GROUP BY action
    ORDER BY count DESC
    LIMIT 10
  `).all();

  return {
    days: safeDays,
    signups,
    tunnelOpens,
    tunnelCloses,
    planDistribution,
    recentActions,
    last24h: {
      signups: db.prepare(`
        SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now', '-24 hours')
      `).get().c,
      tunnelOpens: db.prepare(`
        SELECT COUNT(*) AS c FROM audit_logs
        WHERE action = 'tunnel.open' AND created_at >= datetime('now', '-24 hours')
      `).get().c,
    },
  };
}

export function publicPlan(plan) {
  const features = parsePlanFeatures(plan.features);
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.price_monthly,
    priceYearly: plan.price_yearly,
    currency: plan.currency,
    tunnelLimit: plan.tunnel_limit,
    reservedSubdomainLimit: plan.reserved_subdomain_limit,
    customSubdomain: Boolean(plan.custom_subdomain),
    planType: plan.plan_type || 'personal',
    visibility: plan.visibility || 'public',
    maxSeats: plan.max_seats ?? 1,
    features,
    sortOrder: plan.sort_order,
    active: Boolean(plan.active),
    wompiProductId: plan.wompi_product_id || null,
  };
}

export function publicUser(user) {
  const limits = getUserLimits(user);
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    planName: limits.planName,
    planType: limits.planType,
    isAdmin: Boolean(user.is_admin),
    active: Boolean(user.active),
    emailVerified: Boolean(user.email_verified),
    tunnelLimit: limits.tunnelLimit,
    reservedSubdomainLimit: limits.reservedSubdomainLimit,
    customSubdomain: limits.customSubdomain,
    customCname: limits.customCname,
    customCnameLimit: limits.customCnameLimit,
    features: limits.features,
    organizationId: limits.organizationId,
    tunnelLimitOverride: user.tunnel_limit_override,
    reservedSubdomainLimitOverride: user.reserved_subdomain_limit_override,
    createdAt: user.created_at,
  };
}

export function getInactiveSubdomainStatus(subdomain) {
  const name = String(subdomain).toLowerCase();
  const reserved = db.prepare(`
    SELECT rs.id, rs.user_id, rs.name
    FROM reserved_subdomains rs
    WHERE rs.name = ?
  `).get(name);
  const tunnel = findTunnelBySubdomain(name);
  if (tunnel) return { status: 'offline', subdomain: name };
  if (reserved) return { status: 'reserved', subdomain: name };
  return { status: 'available', subdomain: name };
}

export function listReservedSubdomains() {
  return db.prepare(`
    SELECT
      rs.id, rs.name, rs.user_id, rs.created_at,
      u.email,
      (SELECT COUNT(*) FROM active_tunnels at WHERE at.subdomain = rs.name) AS tunnel_active
    FROM reserved_subdomains rs
    JOIN users u ON u.id = rs.user_id
    ORDER BY rs.created_at DESC
  `).all();
}

export function adminReleaseSubdomain(id) {
  const row = db.prepare('SELECT id, name, user_id FROM reserved_subdomains WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('DELETE FROM reserved_subdomains WHERE id = ?').run(id);
  return row;
}

export function deleteUser(id) {
  const user = findUserById(id);
  if (!user) return null;
  releaseAllUserTunnels(id);
  db.prepare('DELETE FROM reserved_subdomains WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return user;
}

export function getAdminSettings() {
  return {
    anonTunnelLimit: getAnonTunnelLimit(),
    heartbeatTimeoutMin: Number(getSetting('heartbeat_timeout_min') || process.env.HEARTBEAT_TIMEOUT_MIN || 10),
    staleTunnelHours: Number(getSetting('stale_tunnel_hours') || process.env.STALE_TUNNEL_HOURS || 24),
  };
}

export function updateAdminSettings(data) {
  if (data.anonTunnelLimit != null) setSetting('anon_tunnel_limit', data.anonTunnelLimit);
  if (data.heartbeatTimeoutMin != null) setSetting('heartbeat_timeout_min', data.heartbeatTimeoutMin);
  if (data.staleTunnelHours != null) setSetting('stale_tunnel_hours', data.staleTunnelHours);
  return getAdminSettings();
}

export function setTotpPendingSecret(userId, secret) {
  db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').run(secret, userId);
}

export function enableTotp(userId, secret, backupHashesJson) {
  db.prepare(`
    UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_backup_hashes = ?, totp_pending_secret = NULL
    WHERE id = ?
  `).run(secret, backupHashesJson, userId);
}

export function disableTotp(userId) {
  db.prepare(`
    UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_backup_hashes = NULL, totp_pending_secret = NULL
    WHERE id = ?
  `).run(userId);
}

export function updateTotpBackupHashes(userId, backupHashesJson) {
  db.prepare('UPDATE users SET totp_backup_hashes = ? WHERE id = ?').run(backupHashesJson, userId);
}

export function getTotpState(user) {
  return {
    enabled: Boolean(user.totp_enabled),
    hasPending: Boolean(user.totp_pending_secret),
  };
}

export function getLiveMetrics() {
  const stats = getAdminStats();
  return {
    ts: new Date().toISOString(),
    stats: {
      ...stats,
      auditLastHour: db.prepare(`
        SELECT COUNT(*) AS c FROM audit_logs WHERE created_at >= datetime('now', '-1 hour')
      `).get().c,
      signupsLastHour: db.prepare(`
        SELECT COUNT(*) AS c FROM users WHERE created_at >= datetime('now', '-1 hour')
      `).get().c,
      tunnelOpensLastHour: db.prepare(`
        SELECT COUNT(*) AS c FROM audit_logs
        WHERE action = 'tunnel.open' AND created_at >= datetime('now', '-1 hour')
      `).get().c,
    },
  };
}

export default db;
