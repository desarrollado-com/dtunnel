import { Router } from 'express';
import { appendAuditLog, listAuditLogs, purgeAuditLogsOlderThan } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  adminReleaseSubdomain,
  cleanupStaleTunnels,
  createPlan,
  deleteTunnel,
  deleteUser,
  findTunnelById,
  findUserById,
  getAdminSettings,
  getAdminStats,
  getAnonTunnelLimit,
  listActiveTunnels,
  listPlans,
  listReservedSubdomains,
  listUsers,
  publicPlan,
  publicUser,
  releaseAllUserTunnels,
  updateAdminSettings,
  updatePlan,
  updateUser,
} from '../db.js';
import { unregisterTunnel } from '../tunnel/native.js';

function normalizePlanInput(body = {}) {
  return {
    slug: body.slug,
    name: body.name,
    description: body.description,
    price_monthly: body.priceMonthly ?? body.price_monthly,
    price_yearly: body.priceYearly ?? body.price_yearly,
    currency: body.currency,
    tunnel_limit: body.tunnelLimit ?? body.tunnel_limit,
    reserved_subdomain_limit: body.reservedSubdomainLimit ?? body.reserved_subdomain_limit,
    custom_subdomain: body.customSubdomain ?? body.custom_subdomain,
    sort_order: body.sortOrder ?? body.sort_order,
    active: body.active,
  };
}

function audit(req, action, targetType = null, targetId = null, details = null) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType,
    targetId,
    details,
    ip: getClientIp(req),
  });
}

export function createAdminRouter({ authRequired, adminRequired }) {
  const router = Router();

  router.use(authRequired, adminRequired);

  router.get('/me', (req, res) => {
    res.json({ ok: true, email: req.user.email, isAdmin: true });
  });

  router.get('/stats', (_req, res) => {
    res.json({
      ...getAdminStats(),
      anonTunnelLimit: getAnonTunnelLimit(),
    });
  });

  router.get('/settings', (_req, res) => {
    res.json(getAdminSettings());
  });

  router.patch('/settings', (req, res) => {
    const body = req.body || {};
    const updates = {};
    if (body.anonTunnelLimit != null) {
      const value = Number(body.anonTunnelLimit);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return res.status(400).json({ error: 'anonTunnelLimit inválido (0-100)' });
      }
      updates.anonTunnelLimit = value;
    }
    if (body.heartbeatTimeoutMin != null) {
      const value = Number(body.heartbeatTimeoutMin);
      if (!Number.isFinite(value) || value < 1 || value > 120) {
        return res.status(400).json({ error: 'heartbeatTimeoutMin inválido (1-120)' });
      }
      updates.heartbeatTimeoutMin = value;
    }
    if (body.staleTunnelHours != null) {
      const value = Number(body.staleTunnelHours);
      if (!Number.isFinite(value) || value < 1 || value > 168) {
        return res.status(400).json({ error: 'staleTunnelHours inválido (1-168)' });
      }
      updates.staleTunnelHours = value;
    }
    const settings = updateAdminSettings(updates);
    audit(req, 'settings.update', 'settings', null, updates);
    res.json(settings);
  });

  router.get('/logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { logs, total } = listAuditLogs({
      limit,
      offset,
      action: req.query.action || null,
      q: req.query.q || null,
    });
    res.json({ logs, total, limit, offset });
  });

  router.post('/maintenance/purge-stale', (req, res) => {
    const settings = getAdminSettings();
    const removed = cleanupStaleTunnels(settings.heartbeatTimeoutMin, settings.staleTunnelHours);
    audit(req, 'maintenance.purge_stale', 'system', null, { removed });
    res.json({ ok: true, removed });
  });

  router.post('/maintenance/purge-logs', (req, res) => {
    const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 365);
    const removed = purgeAuditLogsOlderThan(days);
    audit(req, 'maintenance.purge_logs', 'system', null, { days, removed });
    res.json({ ok: true, removed, days });
  });

  router.get('/users', (_req, res) => {
    const users = listUsers().map((row) => ({
      ...publicUser(row),
      reservedCount: row.reserved_count,
      activeTunnelCount: row.active_tunnel_count,
    }));
    res.json({ users });
  });

  router.get('/users/:id', (req, res) => {
    const user = findUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(publicUser(user));
  });

  router.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { plan, isAdmin, active, tunnelLimitOverride, reservedSubdomainLimitOverride } = req.body || {};
    const updated = updateUser(id, {
      plan,
      is_admin: isAdmin,
      active,
      tunnel_limit_override: tunnelLimitOverride,
      reserved_subdomain_limit_override: reservedSubdomainLimitOverride,
    });
    audit(req, 'user.update', 'user', id, { email: user.email, changes: req.body });
    res.json(publicUser(updated));
  });

  router.post('/users/:id/suspend', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes suspender tu propia cuenta' });
    }
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { changes, subdomains } = releaseAllUserTunnels(id);
    for (const sub of subdomains) unregisterTunnel(sub);
    const updated = updateUser(id, { active: false });
    audit(req, 'user.suspend', 'user', id, { email: user.email, closedTunnels: changes });
    res.json({ ok: true, user: publicUser(updated), closedTunnels: changes });
  });

  router.post('/users/:id/close-tunnels', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { changes, subdomains } = releaseAllUserTunnels(id);
    for (const sub of subdomains) unregisterTunnel(sub);
    audit(req, 'user.close_tunnels', 'user', id, { email: user.email, closedTunnels: changes });
    res.json({ ok: true, closedTunnels: changes });
  });

  router.delete('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { subdomains } = releaseAllUserTunnels(id);
    for (const sub of subdomains) unregisterTunnel(sub);
    deleteUser(id);
    audit(req, 'user.delete', 'user', id, { email: user.email });
    res.json({ ok: true });
  });

  router.get('/plans', (_req, res) => {
    res.json({ plans: listPlans(true).map(publicPlan) });
  });

  router.post('/plans', (req, res) => {
    const { slug, name } = req.body || {};
    if (!slug || !name) {
      return res.status(400).json({ error: 'slug y name son requeridos' });
    }
    try {
      const result = createPlan(normalizePlanInput(req.body));
      const plan = listPlans(true).find((p) => p.id === result.lastInsertRowid);
      audit(req, 'plan.create', 'plan', plan.id, { slug: plan.slug });
      res.status(201).json(publicPlan(plan));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'El slug del plan ya existe' });
      }
      res.status(400).json({ error: e.message });
    }
  });

  router.patch('/plans/:id', (req, res) => {
    const id = Number(req.params.id);
    const plan = updatePlan(id, normalizePlanInput(req.body));
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    audit(req, 'plan.update', 'plan', id, { slug: plan.slug });
    res.json(publicPlan(plan));
  });

  router.get('/tunnels', (_req, res) => {
    const tunnels = listActiveTunnels().map((t) => ({
      id: t.id,
      userId: t.user_id,
      email: t.email,
      subdomain: t.subdomain,
      port: t.port,
      clientIp: t.client_ip,
      lastHeartbeat: t.last_heartbeat,
      createdAt: t.created_at,
    }));
    res.json({ tunnels });
  });

  router.delete('/tunnels/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = findTunnelById(id);
    const result = deleteTunnel(id);
    if (!result.changes) return res.status(404).json({ error: 'Túnel no encontrado' });
    if (row?.subdomain) unregisterTunnel(row.subdomain);
    audit(req, 'tunnel.close', 'tunnel', id, { subdomain: row?.subdomain });
    res.json({ ok: true });
  });

  router.get('/subdomains', (_req, res) => {
    const subdomains = listReservedSubdomains().map((row) => ({
      id: row.id,
      name: row.name,
      userId: row.user_id,
      email: row.email,
      createdAt: row.created_at,
      tunnelActive: Boolean(row.tunnel_active),
    }));
    res.json({ subdomains });
  });

  router.delete('/subdomains/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = adminReleaseSubdomain(id);
    if (!row) return res.status(404).json({ error: 'Subdominio no encontrado' });
    audit(req, 'subdomain.release', 'subdomain', id, { name: row.name, userId: row.user_id });
    res.json({ ok: true, name: row.name });
  });

  return router;
}
