import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByResetToken,
  consumePasswordResetToken,
  createPasswordResetToken,
  updateUserPassword,
  releaseSubdomain,
  getAnonTunnelLimit,
  getReservedSubdomain,
  getUserLimits,
  getUserSubdomains,
  countActiveTunnels,
  countAnonymousTunnelsForIp,
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
  releaseAnonymousTunnelsByIp,
  touchTunnelHeartbeat,
  findTunnelBySubdomain,
  cleanupStaleTunnels,
  getAdminStats,
} from './db.js';
import { createAdminRouter } from './routes/admin.js';
import { getClientIp } from './middleware/clientIp.js';
import { registerLimiter, loginLimiter, tunnelCreateLimiter, forgotPasswordLimiter } from './middleware/rateLimit.js';
import { sendPasswordResetEmail } from './mail.js';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS
  || 'https://dtunnel.desarrollado.com,https://dtunnel-admin.desarrollado.com')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const APP_URL = process.env.APP_URL || 'https://dtunnel.desarrollado.com';

const app = express();
const PORT = process.env.PORT || 3001;
const API_VERSION = process.env.API_VERSION || '1.0.8';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const FRPS_TOKEN = process.env.FRPS_TOKEN || '';
const FRPS_SERVER = process.env.FRPS_SERVER || 'dtunnel.desarrollado.com';
const FRPS_PORT = Number(process.env.FRPS_PORT || 7000);
const DOMAIN = process.env.DOMAIN || 'dtunnel.desarrollado.com';
const ANON_LIMIT = Number(process.env.ANON_TUNNEL_LIMIT || 1);
const HEARTBEAT_TIMEOUT_MIN = Number(process.env.HEARTBEAT_TIMEOUT_MIN || 10);
const STALE_TUNNEL_HOURS = Number(process.env.STALE_TUNNEL_HOURS || 24);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (JWT_SECRET === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') {
  console.warn('ADVERTENCIA: JWT_SECRET por defecto — configura uno seguro en producción');
}

syncAdminUsers(ADMIN_EMAILS);

const removed = cleanupStaleTunnels(HEARTBEAT_TIMEOUT_MIN, STALE_TUNNEL_HOURS);
if (removed > 0) {
  console.log(`Limpieza: ${removed} túnel(es) huérfano(s) eliminado(s)`);
}
setInterval(() => {
  const n = cleanupStaleTunnels(HEARTBEAT_TIMEOUT_MIN, STALE_TUNNEL_HOURS);
  if (n > 0) console.log(`Limpieza automática: ${n} túnel(es) huérfano(s)`);
}, 5 * 60 * 1000);

app.set('trust proxy', 1);
app.use(cors({ origin: ALLOWED_ORIGINS }));
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

function cleanSubdomain(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
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

function canManageTunnel(row, userId, clientIp) {
  if (!row) return false;
  if (row.user_id != null) return userId != null && row.user_id === userId;
  if (row.client_ip && clientIp && row.client_ip !== clientIp) return false;
  return true;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'dtunnel-api', version: API_VERSION });
});

app.get('/status', (_req, res) => {
  const stats = getAdminStats();
  res.json({
    ok: true,
    api: 'ok',
    version: API_VERSION,
    activeTunnels: stats.activeTunnels,
    anonTunnels: stats.anonTunnels,
    timestamp: new Date().toISOString(),
  });
});

app.get('/plans', (_req, res) => {
  res.json({ plans: listPlans().map(publicPlan) });
});

app.post('/auth/register', registerLimiter, (req, res) => {
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

app.post('/auth/login', loginLimiter, (req, res) => {
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

app.post('/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const email = req.body?.email;
  if (!email) {
    return res.status(400).json({ error: 'Email requerido' });
  }
  const user = findUserByEmail(email);
  if (user?.active) {
    try {
      const token = createPasswordResetToken(user.id);
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl: `${APP_URL}/reset-password.html?token=${token}`,
      });
    } catch (err) {
      console.error('Error enviando email de recuperación:', err.message);
    }
  }
  res.json({ ok: true, message: 'Si el email existe, recibirás un enlace de recuperación.' });
});

app.post('/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) {
    return res.status(400).json({ error: 'Token y contraseña (mín. 8 caracteres) requeridos' });
  }
  const row = findUserByResetToken(token);
  if (!row) {
    return res.status(400).json({ error: 'Enlace inválido o expirado' });
  }
  updateUserPassword(row.user_id, password);
  consumePasswordResetToken(token);
  res.json({ ok: true });
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

app.delete('/subdomains/:name', authRequired, (req, res) => {
  const name = String(req.params.name || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!name) {
    return res.status(400).json({ error: 'Nombre inválido' });
  }
  const result = releaseSubdomain(req.user.userId, name);
  if (!result.released) {
    return res.status(404).json({ error: 'Subdominio no encontrado en tu cuenta' });
  }
  res.json({ ok: true, name: result.name });
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

app.post('/tunnels', tunnelCreateLimiter, authOptional, (req, res) => {
  if (!FRPS_TOKEN) {
    return res.status(503).json({ error: 'Servidor no configurado (FRPS_TOKEN)' });
  }

  const port = Number(req.body?.port);
  if (!port || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Puerto inválido' });
  }

  const clientIp = getClientIp(req);
  const userId = req.user?.userId ?? null;
  const dbUser = userId ? req.dbUser || findUserById(userId) : null;
  if (userId && dbUser && !dbUser.active) {
    return res.status(403).json({ error: 'Cuenta desactivada' });
  }

  const limits = getUserLimits(dbUser, getAnonTunnelLimit(ANON_LIMIT));
  let activeCount = userId == null
    ? countAnonymousTunnelsForIp(clientIp)
    : countActiveTunnels(userId);

  if (activeCount >= limits.tunnelLimit) {
    if (userId == null) {
      cleanupStaleTunnels(HEARTBEAT_TIMEOUT_MIN, STALE_TUNNEL_HOURS);
      releaseAnonymousTunnelsByIp(clientIp);
      activeCount = countAnonymousTunnelsForIp(clientIp);
    }
    if (activeCount >= limits.tunnelLimit) {
      return res.status(429).json({ error: `Límite de túneles alcanzado (${limits.tunnelLimit})` });
    }
  }

  let subdomain = cleanSubdomain(req.body?.subdomain);

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

  const result = registerTunnel(userId, subdomain, port, userId == null ? clientIp : null);

  const urls = tunnelUrls(subdomain);
  res.status(201).json({
    ...urls,
    port,
    tunnelId: result.lastInsertRowid,
    server: FRPS_SERVER,
    serverPort: FRPS_PORT,
    token: FRPS_TOKEN,
    persistent: Boolean(userId && req.body?.subdomain),
    heartbeatIntervalSec: 120,
  });
});

app.post('/tunnels/:subdomain/heartbeat', authOptional, (req, res) => {
  const subdomain = cleanSubdomain(req.params.subdomain);
  if (!subdomain) {
    return res.status(400).json({ error: 'Subdominio inválido' });
  }
  const row = findTunnelBySubdomain(subdomain);
  if (!row) {
    return res.status(404).json({ error: 'Túnel no encontrado' });
  }
  const userId = req.user?.userId ?? null;
  const clientIp = getClientIp(req);
  if (!canManageTunnel(row, userId, clientIp)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  touchTunnelHeartbeat(subdomain);
  res.json({ ok: true, subdomain });
});

app.delete('/tunnels/anonymous', authOptional, (req, res) => {
  if (req.user?.userId) {
    return res.status(403).json({ error: 'Solo para sesiones anónimas' });
  }
  const removed = releaseAnonymousTunnelsByIp(getClientIp(req));
  res.json({ ok: true, removed });
});

app.delete('/tunnels/:subdomain', authOptional, (req, res) => {
  const subdomain = cleanSubdomain(req.params.subdomain);
  if (!subdomain) {
    return res.status(400).json({ error: 'Subdominio inválido' });
  }
  try {
    const row = findTunnelBySubdomain(subdomain);
    const userId = req.user?.userId ?? null;
    const clientIp = getClientIp(req);
    if (row && !canManageTunnel(row, userId, clientIp)) {
      return res.status(403).json({ error: 'No autorizado para cerrar este túnel' });
    }
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
  console.log(`dtunnel-api v${API_VERSION} en http://127.0.0.1:${PORT}`);
});
