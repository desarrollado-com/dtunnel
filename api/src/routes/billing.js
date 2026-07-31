import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  activateSubscription,
  createCompSubscription,
  createSubscription,
  findSubscriptionByReference,
  getActiveSubscription,
  incrementCouponUse,
  listSubscriptionsForSubscriber,
  publicSubscription,
  recordPayment,
  validateCoupon,
} from '../billing/store.js';
import {
  grantPlanAccess,
  listPlanGrantsForUser,
  listPlansForUser,
  publicPlanGrant,
  revokePlanAccess,
  userCanAccessPlan,
} from '../billing/plans-access.js';
import { buildCheckoutSession, getWompiPublicConfig, verifyWebhookSignature } from '../billing/wompi.js';
import { findUserById, getPlanBySlug, publicPlan, updateUser } from '../db.js';

function audit(req, action, details) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType: 'billing',
    details,
    ip: getClientIp(req),
  });
}

export function createBillingRouter({ authRequired }) {
  const router = Router();

  router.get('/config', (_req, res) => {
    res.json(getWompiPublicConfig());
  });

  router.get('/plans', authRequired, (req, res) => {
    const user = findUserById(req.user.userId);
    const plans = listPlansForUser(req.user.userId, { currentUserPlan: user?.plan })
      .map(publicPlan);
    const grants = listPlanGrantsForUser(req.user.userId).map(publicPlanGrant);
    res.json({ plans, grants });
  });

  router.get('/subscription', authRequired, (req, res) => {
    const active = getActiveSubscription('user', req.user.userId);
    const history = listSubscriptionsForSubscriber('user', req.user.userId, { limit: 10 })
      .map(publicSubscription);
    res.json({
      active: active ? publicSubscription(active) : null,
      history,
    });
  });

  router.get('/subscriptions', authRequired, (req, res) => {
    const rows = listSubscriptionsForSubscriber('user', req.user.userId, { limit: 50 })
      .map(publicSubscription);
    res.json({ subscriptions: rows });
  });

  router.post('/coupons/validate', authRequired, (req, res) => {
    const { code, planSlug } = req.body || {};
    if (!code || !planSlug) {
      return res.status(400).json({ error: 'code y planSlug requeridos' });
    }
    const result = validateCoupon(code, planSlug);
    if (!result.valid) return res.status(400).json({ error: result.error });
    res.json({ valid: true, coupon: { code: result.coupon.code, discountType: result.coupon.discount_type, discountValue: result.coupon.discount_value } });
  });

  router.post('/checkout', authRequired, (req, res) => {
    const { planSlug, billingCycle = 'monthly', couponCode, subscriberType = 'user', orgId } = req.body || {};
    const plan = getPlanBySlug(planSlug);
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    const user = findUserById(req.user.userId);
    if (!userCanAccessPlan(req.user.userId, planSlug, { currentUserPlan: user?.plan })) {
      return res.status(403).json({ error: 'No tienes acceso a este plan privado' });
    }
    if (plan.price_monthly <= 0 && planSlug !== 'free') {
      return res.status(400).json({ error: 'Este plan requiere contacto comercial' });
    }

    if (planSlug === 'free' || plan.price_monthly <= 0) {
      updateUser(req.user.userId, { plan: planSlug });
      const sub = createCompSubscription({
        subscriberType: 'user',
        subscriberId: req.user.userId,
        planSlug,
        note: 'free_activate',
      });
      audit(req, 'billing.free_activated', { planSlug });
      return res.json({ ok: true, subscription: publicSubscription(sub) });
    }

    let subscriberId = req.user.userId;
    if (subscriberType === 'organization') {
      if (!orgId) return res.status(400).json({ error: 'orgId requerido para planes empresariales' });
      subscriberId = Number(orgId);
    }

    let coupon = null;
    if (couponCode) {
      const validation = validateCoupon(couponCode, planSlug);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
      coupon = validation.coupon;
    }

    const session = buildCheckoutSession({
      plan,
      billingCycle,
      subscriberType,
      subscriberId,
      coupon,
      customerEmail: req.user.email,
    });

    if (!session.ready) {
      return res.status(503).json({ error: session.reason, checkout: session });
    }

    const subResult = createSubscription({
      subscriberType,
      subscriberId,
      planSlug,
      billingCycle,
      couponCode: coupon?.code || null,
      amountCents: session.amountInCents,
      currency: session.currency,
      wompiReference: session.reference,
    });

    audit(req, 'billing.checkout_created', {
      planSlug,
      reference: session.reference,
      subscriptionId: subResult.lastInsertRowid,
    });

    res.json({ checkout: session, subscriptionId: subResult.lastInsertRowid });
  });

  router.post('/webhooks/wompi', (req, res) => {
    if (!verifyWebhookSignature(req.headers, req.body)) {
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const event = req.body?.data || req.body;
    const reference = event?.transaction?.reference || event?.reference;
    const status = event?.transaction?.status || event?.status;
    const transactionId = event?.transaction?.id || event?.id;

    if (!reference) return res.status(400).json({ error: 'reference requerida' });

    const subscription = findSubscriptionByReference(reference);
    if (!subscription) return res.status(404).json({ error: 'Suscripción no encontrada' });

    if (status === 'APPROVED' || status === 'approved') {
      activateSubscription(subscription.id, { wompiTransactionId: transactionId });
      recordPayment({
        subscriptionId: subscription.id,
        amountCents: subscription.amount_cents,
        currency: subscription.currency,
        status: 'approved',
        providerRef: transactionId,
        payload: event,
      });
      if (subscription.coupon_code) incrementCouponUse(subscription.coupon_code);

      if (subscription.subscriber_type === 'user') {
        updateUser(subscription.subscriber_id, { plan: subscription.plan_slug });
      }
      // org plan: organization.plan updated separately when org billing is wired
    }

    res.json({ ok: true });
  });

  return router;
}
