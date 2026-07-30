import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

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

export function syncAdminUsers(adminEmails = []) {
  db.prepare('UPDATE users SET is_admin = 0').run();
  if (!adminEmails.length) return;
  const stmt = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?');
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

export function listPlans(includeInactive = false) {
  if (includeInactive) {
    return db.prepare('SELECT * FROM plans ORDER BY sort_order, id').all();
  }
  return db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order, id').all();
}

export function createPlan(data) {
  const stmt = db.prepare(`
    INSERT INTO plans (
      slug, name, description, price_monthly, price_yearly, currency,
      tunnel_limit, reserved_subdomain_limit, custom_subdomain, sort_order, active
    ) VALUES (
      @slug, @name, @description, @price_monthly, @price_yearly, @currency,
      @tunnel_limit, @reserved_subdomain_limit, @custom_subdomain, @sort_order, @active
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
    id,
  };
  db.prepare(`
    UPDATE plans SET
      slug = @slug, name = @name, description = @description,
      price_monthly = @price_monthly, price_yearly = @price_yearly, currency = @currency,
      tunnel_limit = @tunnel_limit, reserved_subdomain_limit = @reserved_subdomain_limit,
      custom_subdomain = @custom_subdomain, sort_order = @sort_order, active = @active,
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
      plan: null,
    };
  }
  const plan = getPlanBySlug(user.plan || 'free') || getPlanBySlug('free');
  return {
    tunnelLimit: user.tunnel_limit_override ?? plan?.tunnel_limit ?? 5,
    reservedSubdomainLimit: user.reserved_subdomain_limit_override ?? plan?.reserved_subdomain_limit ?? 5,
    customSubdomain: Boolean(plan?.custom_subdomain),
    plan: plan?.slug || user.plan,
    planName: plan?.name || user.plan,
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

export function countActiveTunnels(userId) {
  if (userId == null) {
    return db.prepare('SELECT COUNT(*) AS c FROM active_tunnels WHERE user_id IS NULL').get().c;
  }
  return db.prepare('SELECT COUNT(*) AS c FROM active_tunnels WHERE user_id = ?').get(userId).c;
}

export function registerTunnel(userId, subdomain, port) {
  const stmt = db.prepare('INSERT INTO active_tunnels (user_id, subdomain, port) VALUES (?, ?, ?)');
  return stmt.run(userId ?? null, subdomain, port);
}

export function subdomainTaken(subdomain) {
  return db.prepare('SELECT id FROM active_tunnels WHERE subdomain = ?').get(subdomain);
}

export function listUsers() {
  return db.prepare(`
    SELECT
      u.id, u.email, u.plan, u.is_admin, u.active,
      u.tunnel_limit_override, u.reserved_subdomain_limit_override, u.created_at,
      (SELECT COUNT(*) FROM reserved_subdomains rs WHERE rs.user_id = u.id) AS reserved_count,
      (SELECT COUNT(*) FROM active_tunnels at WHERE at.user_id = u.id) AS active_tunnel_count
    FROM users u
    ORDER BY u.created_at DESC
  `).all();
}

export function updateUser(id, data) {
  const user = findUserById(id);
  if (!user) return null;
  const merged = {
    plan: data.plan ?? user.plan,
    is_admin: data.is_admin != null ? (data.is_admin ? 1 : 0) : user.is_admin,
    active: data.active != null ? (data.active ? 1 : 0) : user.active,
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
      at.id, at.user_id, at.subdomain, at.port, at.created_at,
      u.email
    FROM active_tunnels at
    LEFT JOIN users u ON u.id = at.user_id
    ORDER BY at.created_at DESC
  `).all();
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

export function publicPlan(plan) {
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
    sortOrder: plan.sort_order,
    active: Boolean(plan.active),
  };
}

export function publicUser(user) {
  const limits = getUserLimits(user);
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    planName: limits.planName,
    isAdmin: Boolean(user.is_admin),
    active: Boolean(user.active),
    tunnelLimit: limits.tunnelLimit,
    reservedSubdomainLimit: limits.reservedSubdomainLimit,
    customSubdomain: limits.customSubdomain,
    tunnelLimitOverride: user.tunnel_limit_override,
    reservedSubdomainLimitOverride: user.reserved_subdomain_limit_override,
    createdAt: user.created_at,
  };
}

export default db;
