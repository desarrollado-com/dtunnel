import jwt from 'jsonwebtoken';
import { findUserById } from './db.js';

export function signSessionToken(user, extra = {}, expiresIn = '30d') {
  return jwt.sign({
    userId: user.id,
    email: user.email,
    ...extra,
  }, process.env.JWT_SECRET || 'dev-secret-change-me', { expiresIn });
}

export function sign2faChallenge(user) {
  return jwt.sign({
    userId: user.id,
    email: user.email,
    purpose: '2fa',
  }, process.env.JWT_SECRET || 'dev-secret-change-me', { expiresIn: '5m' });
}

export function verify2faChallenge(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
  if (payload.purpose !== '2fa') throw new Error('Token inválido');
  return payload;
}

export function signImpersonationToken(admin, target) {
  return jwt.sign({
    userId: target.id,
    email: target.email,
    imp: true,
    impBy: admin.id,
    impByEmail: admin.email,
  }, process.env.JWT_SECRET || 'dev-secret-change-me', { expiresIn: '1h' });
}

export function parseAuthPayload(payload) {
  const user = findUserById(payload.userId);
  return {
    user: payload,
    dbUser: user,
    isImpersonating: Boolean(payload.imp),
    impersonator: payload.imp ? { userId: payload.impBy, email: payload.impByEmail } : null,
  };
}
