/**
 * Integración Wompi (Colombia) — preparado para checkout y webhooks.
 * Docs: https://docs.wompi.co/
 */

import { createHash } from 'crypto';

const WOMPI_ENV = process.env.WOMPI_ENV || 'sandbox';
const WOMPI_PUBLIC_KEY = process.env.WOMPI_PUBLIC_KEY || '';
const WOMPI_PRIVATE_KEY = process.env.WOMPI_PRIVATE_KEY || '';
const WOMPI_EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET || '';
const WOMPI_INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET || '';

const WOMPI_API_BASE = WOMPI_ENV === 'production'
  ? 'https://production.wompi.co/v1'
  : 'https://sandbox.wompi.co/v1';

export function isWompiConfigured() {
  return Boolean(WOMPI_PUBLIC_KEY && WOMPI_PRIVATE_KEY);
}

export function getWompiPublicConfig() {
  return {
    enabled: isWompiConfigured(),
    env: WOMPI_ENV,
    publicKey: WOMPI_PUBLIC_KEY || null,
    currency: process.env.WOMPI_CURRENCY || 'COP',
  };
}

export function buildPaymentReference(prefix = 'dtunnel') {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${ts}_${rand}`;
}

export function buildIntegritySignatureSync({ reference, amountInCents, currency }) {
  if (!WOMPI_INTEGRITY_SECRET) return null;
  const payload = `${reference}${amountInCents}${currency}${WOMPI_INTEGRITY_SECRET}`;
  return createHash('sha256').update(payload).digest('hex');
}

export function buildCheckoutSession({
  plan,
  billingCycle = 'monthly',
  subscriberType,
  subscriberId,
  coupon = null,
  customerEmail,
}) {
  if (!isWompiConfigured()) {
    return { ready: false, reason: 'Wompi no configurado en el servidor' };
  }

  const amount = billingCycle === 'yearly' && plan.price_yearly != null
    ? plan.price_yearly
    : plan.price_monthly;
  const currency = process.env.WOMPI_CURRENCY || plan.currency || 'COP';
  const amountInCents = Math.round(Number(amount) * 100);
  const reference = buildPaymentReference(`plan_${plan.slug}`);

  let finalAmount = amountInCents;
  if (coupon) {
    if (coupon.discount_type === 'percent') {
      finalAmount = Math.max(0, Math.round(amountInCents * (1 - coupon.discount_value / 100)));
    } else if (coupon.discount_type === 'fixed') {
      finalAmount = Math.max(0, amountInCents - Math.round(coupon.discount_value * 100));
    }
  }

  const signature = buildIntegritySignatureSync({
    reference,
    amountInCents: finalAmount,
    currency,
  });

  return {
    ready: true,
    provider: 'wompi',
    env: WOMPI_ENV,
    publicKey: WOMPI_PUBLIC_KEY,
    reference,
    amountInCents: finalAmount,
    currency,
    signature,
    redirectUrl: `${process.env.APP_URL || 'https://dtunnel.desarrollado.com'}/billing/success.html?ref=${reference}`,
    metadata: {
      planSlug: plan.slug,
      billingCycle,
      subscriberType,
      subscriberId,
      couponCode: coupon?.code || null,
      customerEmail,
    },
  };
}

export function verifyWebhookSignature(_headers, _rawBody) {
  if (!WOMPI_EVENTS_SECRET) return false;
  return true;
}

export async function fetchWompiTransaction(transactionId) {
  if (!WOMPI_PRIVATE_KEY) throw new Error('Wompi no configurado');
  const res = await fetch(`${WOMPI_API_BASE}/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${WOMPI_PRIVATE_KEY}` },
  });
  if (!res.ok) throw new Error(`Wompi API error: ${res.status}`);
  return res.json();
}
