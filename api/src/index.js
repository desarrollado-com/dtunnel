import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import {
  createUser,
  findUserByEmail,
  findUserById,
  getAnonTunnelLimit,
  getReservedSubdomain,
  getUserLimits,
  getUserSubdomains,
  countActiveTunnels,
  registerTunnel,
  reserveSubdomain,
  subdomainTaken,
  syncAdminUsers,
  listPlans,
  listUserTunnels,
  publicPlan,
  publicUser,
  verifyPassword,
  releaseTunnel,
  cleanupStaleTunnels,
} from './db.js';
import { createAdminRouter } from './routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const FRPS_TOKEN = process.env.FRPS_TOKEN || '';
const FRPS_SERVER = process.env.FRPS_SERVER || 'dtunnel.desarrollado.com';
const FRPS_PORT = Number(process.env.FRPS_PORT || 7000);
const DOMAIN = process.env.DOMAIN || 'dtunnel.desarrollado.com';
const ANON_LIMIT = Number(process.env.ANON_TUNNEL_LIMIT || 1);
const STALE_TUNNEL_HOURS = Number(process.env.STALE_TUNNEL_HOURS || 2);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

syncAdminUsers(ADMIN_EMAILS);

const removed = cleanupStaleTunnels(STALE_TUNNEL_HOURS);
if (removed > 0) {
  console.log(`Limpieza: ${removed} túnel(es) huérfano(s) eliminado(s)`);
}
setInterval(() => {
  const n = cleanupStaleTunnels(STALE_TUNNEL_HOURS);
  if (n > 0) console.log(`Limpieza automática: ${n} túnel(es) huérfano(s)`);
}, 60 * 60 * 1000);

app.use(cors());
app.use(express.json());

function authOptional(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    req.dbUser = null;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req.dbUser = findUserById(payload.userId);
  } catch {
    req.user = null;
    req.dbUser = null;
  }
  next();
}

function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user || !req.dbUser) return res.status(401).json({ error: 'No autenticado' });
    if (!req.dbUser.active) return res.status(403).json({ error: 'Cuenta desactivada' });
    next();
  });
}

function adminRequired(req, res, next) {
  const isAdmin = Boolean(req.dbUser?.is_admin)
    || ADMIN_EMAILS.includes(String(req.user?.email || '').toLowerCase());
  if (!isAdmin) return res.status(403).json({ error: 'Acceso de administrador requerido' });
  next();
}

function randomSubdomain() {
  return randomBytes(4).toString('hex');
}

function tunnelUrls(subdomain) {
  const host = `${subdomain}.${DOMAIN}`;
  return {
    subdomain,
    httpUrl: `http://${host}`,
    httpsUrl: `https://${host}`,
    host,
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dtunnel-api' });
});

app.get('/plans', (_req, res) => {
  res.json({ plans: listPlans().map(publicPlan) });
});

app.post('/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email y contraseña (mín. 8 caracteres) requeridos' });
  }
  try {
    const result = createUser(email, password);
    syncAdminUsers(ADMIN_EMAILS);
    const user = findUserById(result.lastInsertRowid);
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, email: user.email, isAdmin: Boolean(user.is_admin) });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Email ya registrado' });
    }
    res.status(500).json({ error: 'Error al registrar' });
  }
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }
  if (!user.active) {
    return res.status(403).json({ error: 'Cuenta desactivada' });
  }
  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({
    token,
    email: user.email,
    isAdmin: Boolean(user.is_admin) || ADMIN_EMAILS.includes(user.email.toLowerCase()),
  });
});

app.get('/me', authRequired, (req, res) => {
  const subdomains = getUserSubdomains(req.user.userId);
  const limits = getUserLimits(req.dbUser, ANON_LIMIT);
  res.json({
    ...publicUser(req.dbUser),
    subdomains: subdomains.map((s) => s.name),
    limits: {
      tunnelLimit: limits.tunnelLimit,
      reservedSubdomainLimit: limits.reservedSubdomainLimit,
      customSubdomain: limits.customSubdomain,
    },
  });
});

app.post('/subdomains/reserve', authRequired, (req, res) => {
  const { name } = req.body || {};
  try {
    reserveSubdomain(req.user.userId, name);
    res.status(201).json({ name: name.toLowerCase(), url: `https://${name.toLowerCase()}.${DOMAIN}` });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Subdominio ya reservado' });
    }
    res.status(400).json({ error: e.message });
  }
});

app.get('/tunnels', authRequired, (req, res) => {
  const tunnels = listUserTunnels(req.user.userId).map((t) => ({
    id: t.id,
    subdomain: t.subdomain,
    port: t.port,
    httpUrl: `http://${t.subdomain}.${DOMAIN}`,
    httpsUrl: `https://${t.subdomain}.${DOMAIN}`,
    createdAt: t.created_at,
  }));
  res.json({ tunnels });
});

app.post('/tunnels', authOptional, (req, res) => {
  if (!FRPS_TOKEN) {
    return res.status(503).json({ error: 'Servidor no configurado (FRPS_TOKEN)' });
  }

  const port = Number(req.body?.port);
  if (!port || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Puerto inválido' });
  }

  const userId = req.user?.userId ?? null;
  const dbUser = userId ? req.dbUser || findUserById(userId) : null;
  if (userId && dbUser && !dbUser.active) {
    return res.status(403).json({ error: 'Cuenta desactivada' });
  }

  const limits = getUserLimits(dbUser, getAnonTunnelLimit(ANON_LIMIT));
  if (countActiveTunnels(userId) >= limits.tunnelLimit) {
    return res.status(429).json({ error: `Límite de túneles alcanzado (${limits.tunnelLimit})` });
  }

  let subdomain = (req.body?.subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (subdomain) {
    if (!userId) {
      return res.status(401).json({ error: 'Inicia sesión para usar subdominio personalizado' });
    }
    if (!limits.customSubdomain) {
      return res.status(403).json({ error: 'Tu plan no permite subdominios personalizados' });
    }
    const reserved = getReservedSubdomain(subdomain);
    if (!reserved || reserved.user_id !== userId) {
      return res.status(403).json({ error: 'Subdominio no reservado en tu cuenta' });
    }
  } else {
    subdomain = randomSubdomain();
    let attempts = 0;
    while (subdomainTaken(subdomain) && attempts < 10) {
      subdomain = randomSubdomain();
      attempts++;
    }
  }

  if (subdomainTaken(subdomain)) {
    return res.status(409).json({ error: 'Subdominio en uso' });
  }

  const result = registerTunnel(userId, subdomain, port);

  const urls = tunnelUrls(subdomain);
  res.status(201).json({
    ...urls,
    port,
    tunnelId: result.lastInsertRowid,
    server: FRPS_SERVER,
    serverPort: FRPS_PORT,
    token: FRPS_TOKEN,
    persistent: Boolean(userId && req.body?.subdomain),
  });
});

app.delete('/tunnels/:subdomain', authOptional, (req, res) => {
  const subdomain = String(req.params.subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!subdomain) {
    return res.status(400).json({ error: 'Subdominio inválido' });
  }
  try {
    const userId = req.user?.userId ?? null;
    const result = releaseTunnel(subdomain, userId);
    if (!result.released) {
      return res.status(404).json({ error: 'Túnel no encontrado' });
    }
    res.json({ ok: true, subdomain });
  } catch (e) {
    if (e.code === 'FORBIDDEN') {
      return res.status(403).json({ error: e.message });
    }
    res.status(500).json({ error: 'Error al cerrar túnel' });
  }
});

app.use('/admin', createAdminRouter({ authRequired, adminRequired }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`dtunnel-api en http://127.0.0.1:${PORT}`);
});
