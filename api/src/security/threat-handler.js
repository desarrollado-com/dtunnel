import { appendAuditLog } from '../audit.js';
import { highestSeverity, scanHttpRequest } from './scanner.js';
import {
  isDeviceBlocked,
  maybeAutoBlockIp,
  recordAbuseEvent,
  setDeviceBlocked,
} from './store.js';

export function inspectTunnelTraffic({
  method,
  path,
  headers = {},
  clientIp = null,
  userId = null,
  subdomain = null,
  fingerprintHash = null,
  userAgent = null,
}) {
  if (fingerprintHash && isDeviceBlocked(fingerprintHash)) {
    return {
      blocked: true,
      reason: 'Dispositivo bloqueado por seguridad',
      matches: [{ id: 'device_blocked', severity: 'critical', label: 'Dispositivo bloqueado' }],
    };
  }

  const matches = scanHttpRequest({ method, path, headers });
  if (!matches.length) return { blocked: false, matches: [] };

  const top = highestSeverity(matches);
  const shouldBlock = top && (top.severity === 'critical' || top.severity === 'high');
  const event = recordAbuseEvent({
    eventType: matches.map((m) => m.id).join(','),
    severity: top?.severity || 'medium',
    ip: clientIp,
    userId,
    subdomain,
    fingerprintHash,
    userAgent,
    details: { method, path, matches },
    actionTaken: shouldBlock ? 'blocked' : 'logged',
    blocked: shouldBlock,
  });

  let blacklist = null;
  if (shouldBlock && clientIp) {
    blacklist = maybeAutoBlockIp(clientIp, {
      eventType: top.id,
      severity: top.severity,
    });
    if (blacklist) {
      appendAuditLog({
        action: 'security.auto_block_ip',
        targetType: 'ip',
        targetId: clientIp,
        details: { reason: blacklist.reason, eventId: event.id },
        ip: clientIp,
      });
    }
  }

  if (shouldBlock && fingerprintHash && top.severity === 'critical') {
    setDeviceBlocked(fingerprintHash, true);
  }

  return {
    blocked: shouldBlock,
    reason: top?.label || 'Actividad sospechosa',
    matches,
    event,
    blacklist,
  };
}
