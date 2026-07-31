import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  createCustomDomain,
  deleteCustomDomain,
  listCustomDomains,
  publicCustomDomain,
} from '../billing/store.js';
import { getUserLimits } from '../db.js';

const TUNNEL_DOMAIN = process.env.DOMAIN || 'dtunnel.desarrollado.com';

function audit(req, action, targetId, details) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType: 'custom_domain',
    targetId,
    details,
    ip: getClientIp(req),
  });
}

export function createCustomDomainsRouter({ authRequired }) {
  const router = Router();
  router.use(authRequired);

  router.get('/', (req, res) => {
    const limits = getUserLimits(req.dbUser);
    const rows = listCustomDomains('user', req.user.userId);
    res.json({
      domains: rows.map(publicCustomDomain),
      limit: limits.customCnameLimit,
      allowed: limits.customCname,
    });
  });

  router.post('/', (req, res) => {
    const limits = getUserLimits(req.dbUser);
    if (!limits.customCname) {
      return res.status(403).json({ error: 'Tu plan no incluye dominio CNAME personalizado' });
    }
    const existing = listCustomDomains('user', req.user.userId);
    if (existing.length >= limits.customCnameLimit) {
      return res.status(403).json({ error: `Límite de dominios CNAME alcanzado (${limits.customCnameLimit})` });
    }

    const { hostname, subdomainName } = req.body || {};
    if (!hostname || !subdomainName) {
      return res.status(400).json({ error: 'hostname y subdomainName requeridos' });
    }

    const cnameTarget = `${subdomainName}.${TUNNEL_DOMAIN}`;
    try {
      const result = createCustomDomain({
        ownerType: 'user',
        ownerId: req.user.userId,
        hostname: hostname.toLowerCase(),
        subdomainName,
        cnameTarget,
      });
      const row = listCustomDomains('user', req.user.userId).find((d) => d.id === result.lastInsertRowid);
      audit(req, 'cname.create', row?.id, { hostname, subdomainName });
      res.status(201).json(publicCustomDomain(row));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'El hostname ya está registrado' });
      }
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const result = deleteCustomDomain(id, 'user', req.user.userId);
    if (!result.changes) return res.status(404).json({ error: 'Dominio no encontrado' });
    audit(req, 'cname.delete', id, {});
    res.json({ ok: true });
  });

  return router;
}
