import { Router } from 'express';
import {
  createPlan,
  deleteTunnel,
  findUserById,
  getAdminStats,
  getAnonTunnelLimit,
  getSetting,
  listActiveTunnels,
  listPlans,
  listUsers,
  publicPlan,
  publicUser,
  setSetting,
  updatePlan,
  releaseAllUserTunnels,
  updateUser,
} from '../db.js';

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
    res.json({
      anonTunnelLimit: getAnonTunnelLimit(),
    });
  });

  router.patch('/settings', (req, res) => {
    const { anonTunnelLimit } = req.body || {};
    if (anonTunnelLimit != null) {
      const value = Number(anonTunnelLimit);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return res.status(400).json({ error: 'anonTunnelLimit inválido (0-100)' });
      }
      setSetting('anon_tunnel_limit', value);
    }
    res.json({ anonTunnelLimit: getAnonTunnelLimit() });
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
    res.json(publicUser(updated));
  });

  router.post('/users/:id/suspend', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes suspender tu propia cuenta' });
    }
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const closedTunnels = releaseAllUserTunnels(id);
    const updated = updateUser(id, { active: false });
    res.json({ ok: true, user: publicUser(updated), closedTunnels });
  });

  router.post('/users/:id/close-tunnels', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const closedTunnels = releaseAllUserTunnels(id);
    res.json({ ok: true, closedTunnels });
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
      res.status(201).json(publicPlan(plan));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'El slug del plan ya existe' });
      }
      res.status(400).json({ error: e.message });
    }
  });

  router.patch('/plans/:id', (req, res) => {
    const plan = updatePlan(Number(req.params.id), normalizePlanInput(req.body));
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
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
    const result = deleteTunnel(Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Túnel no encontrado' });
    res.json({ ok: true });
  });

  return router;
}
