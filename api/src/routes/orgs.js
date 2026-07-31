import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  addOrganizationMember,
  createOrganization,
  findOrganizationById,
  listOrganizationMembers,
  listUserOrganizations,
  publicOrganization,
} from '../billing/store.js';
import { getPlanBySlug, listPlans } from '../db.js';
import { getOrgPermissions, userHasPermission } from '../rbac.js';

function audit(req, action, targetId, details) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType: 'organization',
    targetId,
    details,
    ip: getClientIp(req),
  });
}

export function createOrgsRouter({ authRequired }) {
  const router = Router();
  router.use(authRequired);

  router.get('/', (req, res) => {
    const orgs = listUserOrganizations(req.user.userId).map((row) => publicOrganization(row, { memberRole: row.role_slug }));
    res.json({ organizations: orgs });
  });

  router.post('/', (req, res) => {
    const { name, slug, plan = 'team', billingEmail } = req.body || {};
    if (!name || !slug) return res.status(400).json({ error: 'name y slug requeridos' });
    const planRow = getPlanBySlug(plan);
    if (!planRow || planRow.plan_type !== 'enterprise') {
      return res.status(400).json({ error: 'Plan empresarial no válido' });
    }
    try {
      const org = createOrganization({
        name,
        slug,
        plan,
        ownerUserId: req.user.userId,
        billingEmail: billingEmail || req.user.email,
        seatLimit: planRow.max_seats,
      });
      audit(req, 'org.create', org.id, { name, slug, plan });
      res.status(201).json(publicOrganization(org, { memberRole: 'org_owner' }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/:id', (req, res) => {
    const org = findOrganizationById(Number(req.params.id));
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    const perms = getOrgPermissions(req.user.userId, org.id);
    const isMember = perms.size > 0 || org.owner_user_id === req.user.userId;
    if (!isMember) return res.status(403).json({ error: 'No perteneces a esta organización' });
    res.json(publicOrganization(org));
  });

  router.get('/:id/members', (req, res) => {
    const orgId = Number(req.params.id);
    const org = findOrganizationById(orgId);
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    if (!userHasPermission(req.dbUser, 'org.read', { orgId }) && org.owner_user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permiso insuficiente' });
    }
    const members = listOrganizationMembers(orgId).map((m) => ({
      id: m.id,
      userId: m.user_id,
      email: m.email || m.invited_email,
      roleSlug: m.role_slug,
      status: m.status,
      createdAt: m.created_at,
    }));
    res.json({ members });
  });

  router.post('/:id/members', (req, res) => {
    const orgId = Number(req.params.id);
    const org = findOrganizationById(orgId);
    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });
    if (!userHasPermission(req.dbUser, 'org.invite', { orgId }) && org.owner_user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Permiso insuficiente' });
    }
    const { email, userId, roleSlug = 'org_member' } = req.body || {};
    if (!email && !userId) return res.status(400).json({ error: 'email o userId requerido' });
    try {
      addOrganizationMember(orgId, { userId, email, roleSlug });
      audit(req, 'org.invite', orgId, { email, userId, roleSlug });
      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/meta/enterprise-plans', (_req, res) => {
    const plans = listPlans(false, { publicOnly: true })
      .filter((p) => p.plan_type === 'enterprise')
      .map((p) => ({ slug: p.slug, name: p.name, maxSeats: p.max_seats }));
    res.json({ plans });
  });

  return router;
}
