import { getClientIp } from '../middleware/clientIp.js';
import { isIpBlacklisted, isIpWhitelisted, recordAbuseEvent } from './store.js';

export function createIpPolicyMiddleware({ scope = 'api' } = {}) {
  return (req, res, next) => {
    const ip = getClientIp(req);
    if (!ip) return next();
    if (isIpWhitelisted(ip)) {
      req.ipWhitelisted = true;
      return next();
    }
    const block = isIpBlacklisted(ip, scope);
    if (block) {
      recordAbuseEvent({
        eventType: 'ip_blocked',
        severity: 'medium',
        ip,
        details: { scope, path: req.path, reason: block.reason },
        actionTaken: 'blocked',
        blocked: true,
      });
      return res.status(403).json({
        error: 'IP bloqueada',
        code: 'IP_BLACKLISTED',
        reason: block.reason,
        remediation: block.remediation,
        expiresAt: block.expiresAt,
      });
    }
    next();
  };
}

export function assertIpAllowed(ip, scope = 'tunnel') {
  if (!ip) return null;
  if (isIpWhitelisted(ip)) return null;
  return isIpBlacklisted(ip, scope);
}
