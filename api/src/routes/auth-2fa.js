import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  disableTotp,
  enableTotp,
  findUserById,
  getTotpState,
  setTotpPendingSecret,
  updateTotpBackupHashes,
  verifyPassword,
} from '../db.js';
import {
  buildTotpUri,
  consumeBackupCode,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  verifyBackupCode,
  verifyTotpToken,
} from '../totp.js';
import { sign2faChallenge, signSessionToken, verify2faChallenge } from '../auth-tokens.js';

function audit(req, action, details) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType: 'auth',
    details,
    ip: getClientIp(req),
  });
}

export function create2faRouter({ authRequired, loginLimiter, resolveIsAdmin }) {
  const router = Router();

  router.get('/status', authRequired, (req, res) => {
    res.json(getTotpState(req.dbUser));
  });

  router.post('/setup', authRequired, (req, res) => {
    const secret = generateTotpSecret();
    setTotpPendingSecret(req.user.userId, secret);
    const otpauthUrl = buildTotpUri(req.user.email, secret);
    res.json({
      secret,
      otpauthUrl,
      qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUrl)}`,
    });
  });

  router.post('/enable', authRequired, (req, res) => {
    const code = req.body?.code;
    const user = findUserById(req.user.userId);
    if (!user?.totp_pending_secret) {
      return res.status(400).json({ error: 'Ejecuta setup primero' });
    }
    if (!verifyTotpToken(user.totp_pending_secret, code)) {
      return res.status(400).json({ error: 'Código incorrecto' });
    }
    const backupCodes = generateBackupCodes();
    const hashes = hashBackupCodes(backupCodes);
    enableTotp(user.id, user.totp_pending_secret, JSON.stringify(hashes));
    audit(req, '2fa.enable', {});
    res.json({ ok: true, backupCodes });
  });

  router.post('/disable', authRequired, loginLimiter, (req, res) => {
    const { code, password } = req.body || {};
    const user = findUserById(req.user.userId);
    if (!user?.totp_enabled) return res.status(400).json({ error: '2FA no está activo' });
    if (!verifyPassword(user, password)) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    if (!verifyTotpToken(user.totp_secret, code)) {
      return res.status(400).json({ error: 'Código 2FA incorrecto' });
    }
    disableTotp(user.id);
    audit(req, '2fa.disable', {});
    res.json({ ok: true });
  });

  router.post('/verify', loginLimiter, (req, res) => {
    const { tempToken, code, backupCode } = req.body || {};
    if (!tempToken) return res.status(400).json({ error: 'tempToken requerido' });

    let payload;
    try {
      payload = verify2faChallenge(tempToken);
    } catch {
      return res.status(401).json({ error: 'Sesión 2FA expirada' });
    }

    const user = findUserById(payload.userId);
    if (!user?.totp_enabled || !user.totp_secret) {
      return res.status(400).json({ error: '2FA no configurado' });
    }

    let verified = false;
    if (backupCode) {
      const hashes = user.totp_backup_hashes ? JSON.parse(user.totp_backup_hashes) : [];
      const result = verifyBackupCode(backupCode, hashes);
      if (result.ok) {
        verified = true;
        updateTotpBackupHashes(user.id, JSON.stringify(consumeBackupCode(hashes, result.index)));
      }
    } else if (verifyTotpToken(user.totp_secret, code)) {
      verified = true;
    }

    if (!verified) return res.status(401).json({ error: 'Código 2FA inválido' });

    const isAdmin = resolveIsAdmin(user);
    const token = signSessionToken(user);
    res.json({
      token,
      email: user.email,
      isAdmin,
      emailVerified: Boolean(user.email_verified),
    });
  });

  return router;
}
