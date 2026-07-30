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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
`);

export function createUser(email, password) {
  const hash = bcrypt.hashSync(password, 10);
  const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
  return stmt.run(email.toLowerCase().trim(), hash);
}

export function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(password, user.password_hash);
}

export function reserveSubdomain(userId, name) {
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

export default db;
