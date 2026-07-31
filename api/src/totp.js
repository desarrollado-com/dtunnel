import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

authenticator.options = { window: 1 };

const APP_NAME = process.env.TOTP_ISSUER || 'dtunnel';

export function generateTotpSecret() {
  return authenticator.generateSecret();
}

export function buildTotpUri(email, secret) {
  return authenticator.keyuri(email, APP_NAME, secret);
}

export function verifyTotpToken(secret, token) {
  if (!secret || !token) return false;
  return authenticator.check(String(token).replace(/\s/g, ''), secret);
}

export function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(randomBytes(4).toString('hex').toUpperCase());
  }
  return codes;
}

export function hashBackupCodes(codes) {
  return codes.map((code) => bcrypt.hashSync(code, 8));
}

export function verifyBackupCode(plainCode, hashedList) {
  if (!plainCode || !hashedList?.length) return { ok: false, index: -1 };
  const normalized = String(plainCode).replace(/\s/g, '').toUpperCase();
  for (let i = 0; i < hashedList.length; i += 1) {
    if (hashedList[i] && bcrypt.compareSync(normalized, hashedList[i])) {
      return { ok: true, index: i };
    }
  }
  return { ok: false, index: -1 };
}

export function consumeBackupCode(hashedList, index) {
  const next = [...hashedList];
  if (index >= 0 && index < next.length) next[index] = null;
  return next;
}
