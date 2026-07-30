import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import {
  createUser,
  findUserByEmail,
  verifyPassword,
  reserveSubdomain,
  getReservedSubdomain,
  getUserSubdomains,
  countActiveTunnels,
  registerTunnel,
  subdomainTaken,
} from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const FRPS_TOKEN = process.env.FRPS_TOKEN || '';
const FRPS_SERVER = process.env.FRPS_SERVER || 'dtunnel.desarrollado.com';
const FRPS_PORT = Number(process.env.FRPS_PORT || 7000);
const DOMAIN = process.env.DOMAIN || 'dtunnel.desarrollado.com';
const ANON_LIMIT = Number(process.env.ANON_TUNNEL_LIMIT || 1);
const USER_LIMIT = Number(process.env.USER_TUNNEL_LIMIT || 5);

app.use(cors());
app.use(express.json());

function authOptional(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

function authRequired(req, res, next) {
  authOptional(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    next();
  });
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

app.post('/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email y contraseña (mín. 8 caracteres) requeridos' });
  }
  try {
    const result = createUser(email, password);
    const token = jwt.sign({ userId: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, email });
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
  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, email: user.email });
});

app.get('/me', authRequired, (req, res) => {
  const subdomains = getUserSubdomains(req.user.userId);
  res.json({ email: req.user.email, subdomains: subdomains.map((s) => s.name) });
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

app.post('/tunnels', authOptional, (req, res) => {
  if (!FRPS_TOKEN) {
    return res.status(503).json({ error: 'Servidor no configurado (FRPS_TOKEN)' });
  }

  const port = Number(req.body?.port);
  if (!port || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Puerto inválido' });
  }

  const userId = req.user?.userId ?? null;
  const limit = userId ? USER_LIMIT : ANON_LIMIT;
  if (countActiveTunnels(userId) >= limit) {
    return res.status(429).json({ error: `Límite de túneles alcanzado (${limit})` });
  }

  let subdomain = (req.body?.subdomain || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (subdomain) {
    if (!userId) {
      return res.status(401).json({ error: 'Inicia sesión para usar subdominio personalizado' });
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

  registerTunnel(userId, subdomain, port);

  const urls = tunnelUrls(subdomain);
  res.status(201).json({
    ...urls,
    port,
    server: FRPS_SERVER,
    serverPort: FRPS_PORT,
    token: FRPS_TOKEN,
    persistent: Boolean(userId && req.body?.subdomain),
  });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`dtunnel-api en http://127.0.0.1:${PORT}`);
});
