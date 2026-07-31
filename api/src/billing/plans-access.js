import db from '../db.js';
import { getPlanBySlug, listPlans } from '../db.js';

const PRIVATE_VISIBILITIES = new Set(['private', 'hidden', 'internal']);

export function isPublicVisibility(visibility) {
  return (visibility || 'public') === 'public';
}

export function isPrivateVisibility(visibility) {
  return PRIVATE_VISIBILITIES.has(visibility || 'public');
}

export function normalizeVisibility(visibility) {
  if (!visibility || visibility === 'public') return 'public';
  return 'private';
}

export function userHasPlanGrant(userId, planSlug) {
  const row = db.prepare(`
    SELECT 1 FROM plan_grants
    WHERE user_id = ? AND plan_slug = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(userId, planSlug);
  return Boolean(row);
}

export function userCanAccessPlan(userId, planSlug, { currentUserPlan = null } = {}) {
  const plan = getPlanBySlug(planSlug);
  if (!plan) return false;
  if (isPublicVisibility(plan.visibility)) return true;
  if (currentUserPlan === planSlug) return true;
  return userHasPlanGrant(userId, planSlug);
}

export function listPlansForUser(userId, { currentUserPlan = null } = {}) {
  const publicPlans = listPlans(false, { publicOnly: true });
  const privateSlugs = new Set();

  if (currentUserPlan) {
    const current = getPlanBySlug(currentUserPlan);
    if (current && isPrivateVisibility(current.visibility)) {
      privateSlugs.add(currentUserPlan);
    }
  }

  const grants = db.prepare(`
    SELECT plan_slug FROM plan_grants
    WHERE user_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).all(userId);
  for (const g of grants) privateSlugs.add(g.plan_slug);

  const privatePlans = [];
  for (const slug of privateSlugs) {
    const plan = getPlanBySlug(slug);
    if (plan && isPrivateVisibility(plan.visibility)) privatePlans.push(plan);
  }

  const seen = new Set(publicPlans.map((p) => p.slug));
  const merged = [...publicPlans];
  for (const p of privatePlans) {
    if (!seen.has(p.slug)) merged.push(p);
  }
  return merged.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function listPlanGrantsForUser(userId) {
  return db.prepare(`
    SELECT pg.*, u.email AS granted_by_email
    FROM plan_grants pg
    LEFT JOIN users u ON u.id = pg.granted_by
    WHERE pg.user_id = ?
    ORDER BY pg.created_at DESC
  `).all(userId);
}

export function grantPlanAccess(userId, planSlug, { grantedBy = null, note = null, expiresAt = null } = {}) {
  const plan = getPlanBySlug(planSlug);
  if (!plan) throw new Error('Plan no encontrado');
  if (isPublicVisibility(plan.visibility)) {
    throw new Error('Los planes públicos no requieren acceso privado');
  }
  db.prepare(`
    INSERT INTO plan_grants (user_id, plan_slug, granted_by, note, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, plan_slug) DO UPDATE SET
      granted_by = excluded.granted_by,
      note = excluded.note,
      expires_at = excluded.expires_at
  `).run(userId, planSlug, grantedBy, note, expiresAt);
  return listPlanGrantsForUser(userId).find((g) => g.plan_slug === planSlug);
}

export function revokePlanAccess(userId, planSlug) {
  return db.prepare('DELETE FROM plan_grants WHERE user_id = ? AND plan_slug = ?').run(userId, planSlug).changes > 0;
}

export function publicPlanGrant(row) {
  return {
    planSlug: row.plan_slug,
    note: row.note,
    expiresAt: row.expires_at,
    grantedByEmail: row.granted_by_email || null,
    createdAt: row.created_at,
  };
}
