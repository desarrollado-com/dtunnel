import db from '../db.js';
import { parsePlanFeatures } from '../schema-extensions.js';

export function listCoupons(includeInactive = false) {
  const clause = includeInactive ? '' : 'WHERE active = 1';
  return db.prepare(`SELECT * FROM coupons ${clause} ORDER BY created_at DESC`).all();
}

export function findCouponByCode(code) {
  return db.prepare('SELECT * FROM coupons WHERE code = ? COLLATE NOCASE').get(String(code).trim());
}

export function validateCoupon(code, planSlug) {
  const coupon = findCouponByCode(code);
  if (!coupon || !coupon.active) return { valid: false, error: 'Cupón no válido' };
  const now = new Date().toISOString();
  if (coupon.valid_from && coupon.valid_from > now) return { valid: false, error: 'Cupón aún no vigente' };
  if (coupon.valid_until && coupon.valid_until < now) return { valid: false, error: 'Cupón expirado' };
  if (coupon.max_uses != null && coupon.uses_count >= coupon.max_uses) {
    return { valid: false, error: 'Cupón agotado' };
  }
  if (coupon.plan_slugs) {
    try {
      const slugs = JSON.parse(coupon.plan_slugs);
      if (slugs.length && !slugs.includes(planSlug)) {
        return { valid: false, error: 'Cupón no aplica a este plan' };
      }
    } catch { /* ignore */ }
  }
  return { valid: true, coupon };
}

export function createCoupon(data) {
  return db.prepare(`
    INSERT INTO coupons (
      code, description, discount_type, discount_value, currency,
      plan_slugs, max_uses, valid_from, valid_until, active
    ) VALUES (
      @code, @description, @discount_type, @discount_value, @currency,
      @plan_slugs, @max_uses, @valid_from, @valid_until, @active
    )
  `).run({
    code: String(data.code).trim().toUpperCase(),
    description: data.description || '',
    discount_type: data.discountType || data.discount_type,
    discount_value: Number(data.discountValue ?? data.discount_value),
    currency: data.currency || null,
    plan_slugs: data.planSlugs ? JSON.stringify(data.planSlugs) : null,
    max_uses: data.maxUses ?? data.max_uses ?? null,
    valid_from: data.validFrom ?? data.valid_from ?? null,
    valid_until: data.validUntil ?? data.valid_until ?? null,
    active: data.active === false ? 0 : 1,
  });
}

export function updateCoupon(id, data) {
  const existing = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
  if (!existing) return null;
  const merged = {
    description: data.description ?? existing.description,
    discount_type: data.discountType ?? data.discount_type ?? existing.discount_type,
    discount_value: data.discountValue != null ? Number(data.discountValue) : existing.discount_value,
    currency: data.currency ?? existing.currency,
    plan_slugs: data.planSlugs != null ? JSON.stringify(data.planSlugs) : existing.plan_slugs,
    max_uses: data.maxUses != null ? data.maxUses : existing.max_uses,
    valid_from: data.validFrom ?? existing.valid_from,
    valid_until: data.validUntil ?? existing.valid_until,
    active: data.active != null ? (data.active ? 1 : 0) : existing.active,
    id,
  };
  db.prepare(`
    UPDATE coupons SET
      description = @description, discount_type = @discount_type, discount_value = @discount_value,
      currency = @currency, plan_slugs = @plan_slugs, max_uses = @max_uses,
      valid_from = @valid_from, valid_until = @valid_until, active = @active
    WHERE id = @id
  `).run(merged);
  return db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
}

export function publicCoupon(row) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discount_type,
    discountValue: row.discount_value,
    currency: row.currency,
    planSlugs: row.plan_slugs ? JSON.parse(row.plan_slugs) : null,
    maxUses: row.max_uses,
    usesCount: row.uses_count,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    active: Boolean(row.active),
    createdAt: row.created_at,
  };
}

export function createSubscription({
  subscriberType,
  subscriberId,
  planSlug,
  billingCycle,
  couponCode,
  amountCents,
  currency,
  wompiReference,
}) {
  return db.prepare(`
    INSERT INTO subscriptions (
      subscriber_type, subscriber_id, plan_slug, status, billing_cycle,
      coupon_code, amount_cents, currency, wompi_reference
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    subscriberType,
    subscriberId,
    planSlug,
    billingCycle,
    couponCode,
    amountCents,
    currency,
    wompiReference,
  );
}

export function findSubscriptionByReference(reference) {
  return db.prepare('SELECT * FROM subscriptions WHERE wompi_reference = ?').get(reference);
}

export function activateSubscription(id, { wompiTransactionId, periodEnd } = {}) {
  db.prepare(`
    UPDATE subscriptions SET
      status = 'active',
      wompi_transaction_id = COALESCE(?, wompi_transaction_id),
      current_period_start = datetime('now'),
      current_period_end = COALESCE(?, current_period_end),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(wompiTransactionId, periodEnd, id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

export function recordPayment({ subscriptionId, amountCents, currency, status, providerRef, payload }) {
  return db.prepare(`
    INSERT INTO payments (subscription_id, amount_cents, currency, status, provider_ref, provider_payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(subscriptionId, amountCents, currency, status, providerRef, payload ? JSON.stringify(payload) : null);
}

export function incrementCouponUse(code) {
  db.prepare('UPDATE coupons SET uses_count = uses_count + 1 WHERE code = ?').run(code);
}

export function listSubscriptionsForSubscriber(subscriberType, subscriberId, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE subscriber_type = ? AND subscriber_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(subscriberType, subscriberId, limit);
}

export function getActiveSubscription(subscriberType, subscriberId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE subscriber_type = ? AND subscriber_id = ? AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(subscriberType, subscriberId);
}

export function listSubscriptionsAdmin({
  status = null,
  q = null,
  limit = 50,
  offset = 0,
} = {}) {
  const params = [];
  const where = [];
  if (status) {
    where.push('s.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(s.plan_slug LIKE ? OR s.wompi_reference LIKE ? OR u.email LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = db.prepare(`
    SELECT s.*, u.email
    FROM subscriptions s
    LEFT JOIN users u ON s.subscriber_type = 'user' AND u.id = s.subscriber_id
    ${clause}
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, safeLimit, safeOffset);
  const total = db.prepare(`
    SELECT COUNT(*) AS c FROM subscriptions s
    LEFT JOIN users u ON s.subscriber_type = 'user' AND u.id = s.subscriber_id
    ${clause}
  `).get(...params).c;
  return { subscriptions: rows, total, limit: safeLimit, offset: safeOffset };
}

export function createCompSubscription({
  subscriberType,
  subscriberId,
  planSlug,
  billingCycle = 'monthly',
  note = null,
}) {
  const reference = `comp_${subscriberType}_${subscriberId}_${Date.now()}`;
  const result = db.prepare(`
    INSERT INTO subscriptions (
      subscriber_type, subscriber_id, plan_slug, status, billing_cycle,
      amount_cents, currency, wompi_reference, current_period_start,
      current_period_end, coupon_code
    ) VALUES (?, ?, ?, 'active', ?, 0, 'USD', ?, datetime('now'), datetime('now', '+1 month'), NULL)
  `).run(subscriberType, subscriberId, planSlug, billingCycle, reference);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(result.lastInsertRowid);
}

export function publicSubscription(row) {
  return {
    id: row.id,
    subscriberType: row.subscriber_type,
    subscriberId: row.subscriber_id,
    planSlug: row.plan_slug,
    status: row.status,
    billingCycle: row.billing_cycle,
    amountCents: row.amount_cents,
    currency: row.currency,
    couponCode: row.coupon_code,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    wompiReference: row.wompi_reference,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    email: row.email || null,
  };
}

// --- Organizations ---

export function createOrganization({ name, slug, plan, ownerUserId, billingEmail, seatLimit }) {
  const cleanSlug = String(slug).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const result = db.prepare(`
    INSERT INTO organizations (name, slug, plan, owner_user_id, billing_email, seat_limit)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, cleanSlug, plan, ownerUserId, billingEmail || null, seatLimit ?? null);
  const orgId = result.lastInsertRowid;
  db.prepare(`
    INSERT INTO organization_members (org_id, user_id, role_slug, status)
    VALUES (?, ?, 'org_owner', 'active')
  `).run(orgId, ownerUserId);
  db.prepare('UPDATE users SET primary_org_id = ? WHERE id = ?').run(orgId, ownerUserId);
  return findOrganizationById(orgId);
}

export function findOrganizationById(id) {
  return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id);
}

export function findOrganizationBySlug(slug) {
  return db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug);
}

export function listUserOrganizations(userId) {
  return db.prepare(`
    SELECT o.*, om.role_slug, om.status AS member_status
    FROM organization_members om
    JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = ? AND om.status = 'active'
    ORDER BY o.name
  `).all(userId);
}

export function listOrganizationMembers(orgId) {
  return db.prepare(`
    SELECT om.*, u.email, u.active AS user_active
    FROM organization_members om
    LEFT JOIN users u ON u.id = om.user_id
    WHERE om.org_id = ?
    ORDER BY om.created_at
  `).all(orgId);
}

export function addOrganizationMember(orgId, { userId, email, roleSlug = 'org_member' }) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM organization_members WHERE org_id = ? AND status = ?').get(orgId, 'active').c;
  const org = findOrganizationById(orgId);
  const plan = db.prepare('SELECT * FROM plans WHERE slug = ?').get(org.plan);
  const seatLimit = org.seat_limit ?? plan?.max_seats ?? 25;
  if (count >= seatLimit) throw new Error(`Límite de asientos alcanzado (${seatLimit})`);

  if (userId) {
    return db.prepare(`
      INSERT INTO organization_members (org_id, user_id, role_slug, status)
      VALUES (?, ?, ?, 'active')
    `).run(orgId, userId, roleSlug);
  }
  return db.prepare(`
    INSERT INTO organization_members (org_id, invited_email, role_slug, status)
    VALUES (?, ?, ?, 'invited')
  `).run(orgId, email, roleSlug);
}

export function publicOrganization(org, { memberRole } = {}) {
  const plan = db.prepare('SELECT * FROM plans WHERE slug = ?').get(org.plan);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    planName: plan?.name || org.plan,
    planType: plan?.plan_type || 'enterprise',
    seatLimit: org.seat_limit ?? plan?.max_seats,
    billingEmail: org.billing_email,
    active: Boolean(org.active),
    memberRole: memberRole || org.role_slug,
    features: plan ? parsePlanFeatures(plan.features) : null,
    createdAt: org.created_at,
  };
}

// --- Custom domains (CNAME) ---

export function listCustomDomains(ownerType, ownerId) {
  return db.prepare(`
    SELECT * FROM custom_domains WHERE owner_type = ? AND owner_id = ?
    ORDER BY created_at DESC
  `).all(ownerType, ownerId);
}

export function createCustomDomain({ ownerType, ownerId, hostname, subdomainName, cnameTarget }) {
  const token = Math.random().toString(36).slice(2, 12);
  return db.prepare(`
    INSERT INTO custom_domains (owner_type, owner_id, hostname, subdomain_name, cname_target, verification_token)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ownerType, ownerId, hostname.toLowerCase(), subdomainName, cnameTarget, token);
}

export function deleteCustomDomain(id, ownerType, ownerId) {
  return db.prepare('DELETE FROM custom_domains WHERE id = ? AND owner_type = ? AND owner_id = ?').run(id, ownerType, ownerId);
}

export function publicCustomDomain(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    subdomainName: row.subdomain_name,
    cnameTarget: row.cname_target,
    verified: Boolean(row.verified),
    sslStatus: row.ssl_status,
    createdAt: row.created_at,
    dnsInstructions: {
      type: 'CNAME',
      host: row.hostname,
      value: row.cname_target,
      note: 'Apunta tu dominio al target indicado. La verificación puede tardar hasta 48 h.',
    },
  };
}
