import { Router } from 'express';
import { appendAuditLog, listAuditLogs, purgeAuditLogsOlderThan } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  adminReleaseSubdomain,
  closeAnonymousTunnelsByIp,
  cleanupStaleTunnels,
  createPlan,
  createUser,
  createEmailVerificationToken,
  createPasswordResetToken,
  deleteTunnel,
  deleteUser,
  findTunnelById,
  findUserByEmail,
  findUserById,
  getAdminAnalytics,
  getAdminHealthMeta,
  getAdminSettings,
  getAdminStats,
  getAnonTunnelLimit,
  getPlanBySlug,
  getTotpState,
  listActiveTunnels,
  listAnonymousTunnels,
  listPlans,
  listReservedSubdomains,
  listUsers,
  listUsersPaginated,
  publicPlan,
  publicUser,
  releaseAllUserTunnels,
  updateAdminSettings,
  updatePlan,
  updateUser,
} from '../db.js';
import { sendActivationEmail, sendPasswordResetEmail } from '../mail.js';
import { unregisterTunnel } from '../tunnel/native.js';
import {
  createCoupon,
  createCompSubscription,
  listCoupons,
  listSubscriptionsAdmin,
  publicCoupon,
  publicSubscription,
  updateCoupon,
} from '../billing/store.js';
import {
  grantPlanAccess,
  isPrivateVisibility,
  listPlanGrantsForUser,
  publicPlanGrant,
  revokePlanAccess,
} from '../billing/plans-access.js';
import {
  createRole,
  deleteRole,
  listRoles,
  publicRole,
  getUserSystemRoles,
  setUserSystemRoles,
  updateRole,
  PERMISSIONS,
} from '../rbac.js';
import db from '../db.js';
import { signImpersonationToken, signSessionToken } from '../auth-tokens.js';
import {
  getRequestTraceStats,
  listRequestTracesAdmin,
  purgeRequestTracesOlderThan,
} from '../request-trace.js';
import { createSecurityAdminRouter } from './security-admin.js';
import { createSupportAdminRouter } from './support-admin.js';
import { createCommunityAdminRouter } from './community-admin.js';

const APP_URL = process.env.APP_URL || 'https://dtunnel.desarrollado.com';

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
    plan_type: body.planType ?? body.plan_type,
    visibility: body.visibility,
    max_seats: body.maxSeats ?? body.max_seats,
    features: body.features,
    wompi_product_id: body.wompiProductId ?? body.wompi_product_id,
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

export function createAdminRouter({ authRequired, adminRequired, apiVersion, uptimeSeconds, resolveIsAdmin }) {
  const router = Router();

  router.post('/impersonate/stop', authRequired, (req, res) => {
    if (!req.user?.imp) {
      return res.status(400).json({ error: 'No hay sesión de impersonación activa' });
    }
    const admin = findUserById(req.user.impBy);
    if (!admin || !resolveIsAdmin(admin)) {
      return res.status(403).json({ error: 'Administrador original no válido' });
    }
    audit({
      ...req,
      user: { userId: admin.id, email: admin.email },
    }, 'user.impersonate_stop', 'user', req.user.userId, {
      targetEmail: req.user.email,
    });
    const token = signSessionToken(admin);
    res.json({
      token,
      email: admin.email,
      isAdmin: true,
    });
  });

  router.use(authRequired, adminRequired);

  router.get('/me', (req, res) => {
    res.json({
      ok: true,
      email: req.user.email,
      isAdmin: true,
      totp: getTotpState(req.dbUser),
    });
  });

  router.get('/stats', (_req, res) => {
    res.json({
      ...getAdminStats(),
      anonTunnelLimit: getAnonTunnelLimit(),
    });
  });

  router.get('/analytics', (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
    res.json(getAdminAnalytics(days));
  });

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      api: 'ok',
      version: apiVersion,
      transport: 'native',
      uptimeSeconds: uptimeSeconds(),
      timestamp: new Date().toISOString(),
      ...getAdminHealthMeta(),
      settings: getAdminSettings(),
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

  router.get('/request-logs', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const userId = req.query.userId != null ? Number(req.query.userId) : null;
    const status = req.query.status != null ? Number(req.query.status) : null;
    const data = listRequestTracesAdmin({
      q: req.query.q || null,
      subdomain: req.query.subdomain || null,
      userId: Number.isFinite(userId) ? userId : null,
      status: Number.isFinite(status) ? status : null,
      limit,
      offset,
    });
    res.json(data);
  });

  router.get('/request-logs/stats', (_req, res) => {
    res.json(getRequestTraceStats());
  });

  router.post('/maintenance/purge-request-traces', (req, res) => {
    const days = Math.min(Math.max(Number(req.body?.days) || 14, 1), 365);
    const removed = purgeRequestTracesOlderThan(days);
    audit(req, 'maintenance.purge_request_traces', 'system', null, { days, removed });
    res.json({ ok: true, removed, days });
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

  router.get('/users', (req, res) => {
    const mapRow = (row) => ({
      ...publicUser(row),
      reservedCount: row.reserved_count,
      activeTunnelCount: row.active_tunnel_count,
    });
    if (req.query.limit != null || req.query.q || req.query.plan || req.query.active != null) {
      const activeParam = req.query.active;
      let active = null;
      if (activeParam === '1' || activeParam === 'true') active = true;
      if (activeParam === '0' || activeParam === 'false') active = false;
      const { users, total, limit, offset } = listUsersPaginated({
        q: req.query.q || null,
        plan: req.query.plan || null,
        active,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return res.json({ users: users.map(mapRow), total, limit, offset });
    }
    const users = listUsers().map(mapRow);
    res.json({ users, total: users.length });
  });

  router.post('/users', async (req, res) => {
    const {
      email,
      password,
      plan = 'free',
      emailVerified = false,
      isAdmin = false,
      active = true,
      sendActivation = false,
    } = req.body || {};
    if (!email || !password || String(password).length < 8) {
      return res.status(400).json({ error: 'Email y contraseña (mín. 8 caracteres) requeridos' });
    }
    const normalized = email.toLowerCase().trim();
    if (findUserByEmail(normalized)) {
      return res.status(409).json({ error: 'El email ya está registrado' });
    }
    const planRow = listPlans(true).find((p) => p.slug === plan);
    if (!planRow) {
      return res.status(400).json({ error: 'Plan no válido' });
    }
    try {
      const result = createUser(normalized, password);
      const updated = updateUser(result.lastInsertRowid, {
        plan,
        is_admin: isAdmin ? 1 : 0,
        active: active ? 1 : 0,
        email_verified: emailVerified ? 1 : 0,
      });
      if (sendActivation && !emailVerified) {
        try {
          const token = createEmailVerificationToken(updated.id);
          await sendActivationEmail({
            to: updated.email,
            verifyUrl: `${APP_URL}/verify-email.html?token=${token}`,
          });
        } catch (err) {
          console.error('Error enviando email de activación:', err.message);
        }
      }
      audit(req, 'user.create', 'user', updated.id, { email: updated.email, plan });
      res.status(201).json(publicUser(updated));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/users/:id', (req, res) => {
    const user = findUserById(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const roleSlugs = getUserSystemRoles(user.id).map((r) => r.slug);
    res.json({ ...publicUser(user), roleSlugs });
  });

  router.post('/users/:id/impersonate', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes impersonarte a ti mismo' });
    }
    const target = findUserById(id);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!target.active) return res.status(400).json({ error: 'La cuenta está suspendida' });
    const admin = findUserById(req.user.userId);
    const token = signImpersonationToken(admin, target);
    audit(req, 'user.impersonate_start', 'user', id, { email: target.email });
    res.json({
      token,
      email: target.email,
      impersonating: true,
      impersonator: { email: admin.email },
      dashboardUrl: `${APP_URL}/dashboard.html`,
    });
  });

  router.patch('/users/:id', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { plan, isAdmin, active, emailVerified, tunnelLimitOverride, reservedSubdomainLimitOverride, compSubscription } = req.body || {};
    if (plan && plan !== user.plan) {
      const planRow = getPlanBySlug(plan);
      if (!planRow) return res.status(400).json({ error: 'Plan no válido' });
      if (isPrivateVisibility(planRow.visibility)) {
        grantPlanAccess(id, plan, { grantedBy: req.user.userId, note: 'Asignado por admin' });
      }
      if (compSubscription) {
        createCompSubscription({
          subscriberType: 'user',
          subscriberId: id,
          planSlug: plan,
          note: 'admin_assign',
        });
      }
    }
    const updated = updateUser(id, {
      plan,
      is_admin: isAdmin,
      active,
      email_verified: emailVerified,
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

  router.post('/users/:id/send-activation-email', async (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (user.email_verified) {
      return res.status(400).json({ error: 'El email ya está verificado' });
    }
    try {
      const token = createEmailVerificationToken(user.id);
      await sendActivationEmail({
        to: user.email,
        verifyUrl: `${APP_URL}/verify-email.html?token=${token}`,
      });
    } catch (err) {
      console.error('Error enviando email de activación:', err.message);
      return res.status(503).json({ error: err.message || 'No se pudo enviar el correo' });
    }
    audit(req, 'user.send_activation', 'user', id, { email: user.email });
    res.json({ ok: true, message: 'Correo de activación enviado' });
  });

  router.post('/users/:id/send-password-reset', async (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!user.active) {
      return res.status(400).json({ error: 'La cuenta está suspendida' });
    }
    try {
      const token = createPasswordResetToken(user.id);
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl: `${APP_URL}/reset-password.html?token=${token}`,
      });
    } catch (err) {
      console.error('Error enviando email de recuperación:', err.message);
      return res.status(503).json({ error: err.message || 'No se pudo enviar el correo' });
    }
    audit(req, 'user.send_password_reset', 'user', id, { email: user.email });
    res.json({ ok: true, message: 'Correo de recuperación enviado' });
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

  router.get('/subscriptions', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const data = listSubscriptionsAdmin({
      status: req.query.status || null,
      q: req.query.q || null,
      limit,
      offset,
    });
    res.json({
      ...data,
      subscriptions: data.subscriptions.map(publicSubscription),
    });
  });

  router.post('/users/:id/plan-access', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { planSlug, note, expiresAt } = req.body || {};
    if (!planSlug) return res.status(400).json({ error: 'planSlug requerido' });
    try {
      const grant = grantPlanAccess(id, planSlug, {
        grantedBy: req.user.userId,
        note,
        expiresAt: expiresAt || null,
      });
      audit(req, 'plan.grant', 'user', id, { planSlug, note });
      res.status(201).json({ grant: publicPlanGrant(grant) });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/users/:id/plan-access/:planSlug', (req, res) => {
    const id = Number(req.params.id);
    if (!revokePlanAccess(id, req.params.planSlug)) {
      return res.status(404).json({ error: 'Acceso no encontrado' });
    }
    audit(req, 'plan.revoke', 'user', id, { planSlug: req.params.planSlug });
    res.json({ ok: true });
  });

  router.get('/users/:id/plan-access', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ grants: listPlanGrantsForUser(id).map(publicPlanGrant) });
  });

  router.get('/tunnels', (_req, res) => {
    const tunnels = listActiveTunnels().map((t) => ({
      id: t.id,
      userId: t.user_id,
      email: t.email,
      subdomain: t.subdomain,
      port: t.port,
      clientIp: t.client_ip,
      userAgent: t.user_agent,
      clientVersion: t.client_version,
      fingerprintHash: t.fingerprint_hash,
      lastHeartbeat: t.last_heartbeat,
      createdAt: t.created_at,
    }));
    res.json({ tunnels });
  });

  router.get('/tunnels/anonymous', (_req, res) => {
    const rows = listAnonymousTunnels();
    const groupsMap = new Map();
    for (const row of rows) {
      const clientIp = row.client_ip || null;
      const key = clientIp || '__unknown__';
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { clientIp, tunnels: [] });
      }
      groupsMap.get(key).tunnels.push({
        id: row.id,
        subdomain: row.subdomain,
        port: row.port,
        lastHeartbeat: row.last_heartbeat,
        createdAt: row.created_at,
      });
    }
    const groups = [...groupsMap.values()]
      .map((g) => ({ ...g, count: g.tunnels.length }))
      .sort((a, b) => b.count - a.count);
    res.json({ total: rows.length, groups, anonTunnelLimit: getAnonTunnelLimit() });
  });

  router.post('/tunnels/anonymous/close-by-ip', (req, res) => {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) return res.status(400).json({ error: 'ip requerida' });
    const { closed, subdomains } = closeAnonymousTunnelsByIp(ip);
    for (const sub of subdomains) unregisterTunnel(sub);
    audit(req, 'tunnel.close_anon_ip', 'ip', ip, { closed, subdomains });
    res.json({ ok: true, closed, subdomains });
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

  router.get('/roles', (_req, res) => {
    res.json({ roles: listRoles().map(publicRole), permissions: PERMISSIONS });
  });

  router.post('/roles', (req, res) => {
    const { slug, name, scope, permissions } = req.body || {};
    if (!slug || !name || !scope) {
      return res.status(400).json({ error: 'slug, name y scope requeridos' });
    }
    try {
      createRole({ slug, name, scope, permissions: permissions || [] });
      audit(req, 'role.create', 'role', slug, { name, scope });
      res.status(201).json(publicRole(listRoles().find((r) => r.slug === slug)));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.patch('/roles/:slug', (req, res) => {
    const role = updateRole(req.params.slug, { name: req.body?.name, permissions: req.body?.permissions });
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
    audit(req, 'role.update', 'role', req.params.slug, req.body);
    res.json(publicRole(role));
  });

  router.delete('/roles/:slug', (req, res) => {
    if (!deleteRole(req.params.slug)) {
      return res.status(400).json({ error: 'No se puede eliminar el rol' });
    }
    audit(req, 'role.delete', 'role', req.params.slug);
    res.json({ ok: true });
  });

  router.patch('/users/:id/roles', (req, res) => {
    const id = Number(req.params.id);
    const user = findUserById(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    setUserSystemRoles(id, req.body?.roleSlugs || []);
    audit(req, 'user.roles_update', 'user', id, { roleSlugs: req.body?.roleSlugs });
    res.json({ ok: true });
  });

  router.get('/coupons', (_req, res) => {
    res.json({ coupons: listCoupons(true).map(publicCoupon) });
  });

  router.post('/coupons', (req, res) => {
    try {
      const result = createCoupon(req.body || {});
      const row = listCoupons(true).find((c) => c.id === result.lastInsertRowid);
      audit(req, 'coupon.create', 'coupon', row.id, { code: row.code });
      res.status(201).json(publicCoupon(row));
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'El código ya existe' });
      }
      res.status(400).json({ error: e.message });
    }
  });

  router.patch('/coupons/:id', (req, res) => {
    const row = updateCoupon(Number(req.params.id), req.body || {});
    if (!row) return res.status(404).json({ error: 'Cupón no encontrado' });
    audit(req, 'coupon.update', 'coupon', req.params.id, req.body);
    res.json(publicCoupon(row));
  });

  router.use('/security', createSecurityAdminRouter());
  router.use('/support', createSupportAdminRouter());
  router.use('/community', createCommunityAdminRouter());

  router.get('/organizations', (_req, res) => {
    const orgs = db.prepare(`
      SELECT o.*, u.email AS owner_email,
        (SELECT COUNT(*) FROM organization_members om WHERE om.org_id = o.id AND om.status = 'active') AS member_count
      FROM organizations o
      LEFT JOIN users u ON u.id = o.owner_user_id
      ORDER BY o.created_at DESC
    `).all();
    res.json({
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: o.plan,
        ownerEmail: o.owner_email,
        memberCount: o.member_count,
        seatLimit: o.seat_limit,
        active: Boolean(o.active),
        createdAt: o.created_at,
      })),
    });
  });

  return router;
}
