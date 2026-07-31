import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import { closeAnonymousTunnelsByIp } from '../db.js';
import { unregisterTunnel } from '../tunnel/native.js';
import {
  addIpBlacklist,
  addIpWhitelist,
  getSecurityOverview,
  listAbuseEvents,
  listDeviceFingerprints,
  listIpBlacklist,
  listIpWhitelist,
  listTunnelCreatorsSecurity,
  removeIpBlacklist,
  removeIpWhitelist,
  setDeviceBlocked,
} from '../security/store.js';

function audit(req, action, targetType, targetId, details = null) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType,
    targetId: targetId != null ? String(targetId) : null,
    details,
    ip: getClientIp(req),
  });
}

export function createSecurityAdminRouter() {
  const router = Router();

  router.get('/overview', (_req, res) => {
    res.json({
      ...getSecurityOverview(),
      tunnelCreators: listTunnelCreatorsSecurity(),
    });
  });

  router.get('/tunnel-creators', (_req, res) => {
    res.json({ creators: listTunnelCreatorsSecurity() });
  });

  router.get('/ip-blacklist', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const q = String(req.query.q || '').trim();
    res.json(listIpBlacklist({ limit, offset, q }));
  });

  router.post('/ip-blacklist', (req, res) => {
    const { ip, reason, remediation, scope, expiresAt } = req.body || {};
    if (!ip || !reason) return res.status(400).json({ error: 'IP y motivo requeridos' });
    const entry = addIpBlacklist({
      ip: String(ip).trim(),
      reason: String(reason).trim(),
      remediation: remediation ? String(remediation) : null,
      scope: scope || 'all',
      source: 'manual',
      createdBy: req.user?.userId,
      expiresAt: expiresAt || null,
    });
    audit(req, 'security.blacklist.add', 'ip', ip, { reason, scope });
    res.status(201).json(entry);
  });

  router.delete('/ip-blacklist/:id', (req, res) => {
    if (!removeIpBlacklist(Number(req.params.id))) {
      return res.status(404).json({ error: 'Entrada no encontrada' });
    }
    audit(req, 'security.blacklist.remove', 'ip_blacklist', req.params.id);
    res.json({ ok: true });
  });

  router.get('/ip-whitelist', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json(listIpWhitelist({ limit, offset }));
  });

  router.post('/ip-whitelist', (req, res) => {
    const { ip, label, bypassRateLimit, bypassAnonLimit, bypassBlacklist } = req.body || {};
    if (!ip) return res.status(400).json({ error: 'IP requerida' });
    const entry = addIpWhitelist({
      ip: String(ip).trim(),
      label: label ? String(label) : null,
      bypassRateLimit: bypassRateLimit !== false,
      bypassAnonLimit: Boolean(bypassAnonLimit),
      bypassBlacklist: Boolean(bypassBlacklist),
      createdBy: req.user?.userId,
    });
    audit(req, 'security.whitelist.add', 'ip', ip, { label });
    res.status(201).json(entry);
  });

  router.delete('/ip-whitelist/:id', (req, res) => {
    if (!removeIpWhitelist(Number(req.params.id))) {
      return res.status(404).json({ error: 'Entrada no encontrada' });
    }
    audit(req, 'security.whitelist.remove', 'ip_whitelist', req.params.id);
    res.json({ ok: true });
  });

  router.get('/abuse-events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json(listAbuseEvents({
      limit,
      offset,
      severity: String(req.query.severity || ''),
      eventType: String(req.query.eventType || ''),
      ip: String(req.query.ip || '').trim(),
    }));
  });

  router.get('/devices', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const q = String(req.query.q || '').trim();
    res.json(listDeviceFingerprints({ limit, offset, q }));
  });

  router.post('/devices/:hash/block', (req, res) => {
    const hash = req.params.hash;
    const blocked = req.body?.blocked !== false;
    if (!setDeviceBlocked(hash, blocked)) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }
    audit(req, blocked ? 'security.device.block' : 'security.device.unblock', 'device', hash);
    res.json({ ok: true, blocked });
  });

  router.post('/block-ip', async (req, res) => {
    const { ip, reason, closeTunnels = true } = req.body || {};
    if (!ip || !reason) return res.status(400).json({ error: 'IP y motivo requeridos' });
    const entry = addIpBlacklist({
      ip: String(ip).trim(),
      reason: String(reason).trim(),
      source: 'manual',
      createdBy: req.user?.userId,
      scope: 'all',
    });
    let closed = 0;
    const subdomains = [];
    if (closeTunnels) {
      const result = closeAnonymousTunnelsByIp(ip);
      closed = result.closed;
      for (const sub of result.subdomains) {
        subdomains.push(sub);
        unregisterTunnel(sub);
      }
    }
    audit(req, 'security.block_ip', 'ip', ip, { reason, closed });
    res.json({ entry, closedTunnels: closed, subdomains });
  });

  return router;
}
