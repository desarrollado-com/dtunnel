import { createHash } from 'crypto';

export function buildFingerprintHash({ userAgent = '', clientVersion = '', clientId = '' } = {}) {
  const raw = [String(userAgent).trim(), String(clientVersion).trim(), String(clientId).trim()].join('|');
  return createHash('sha256').update(raw || 'unknown').digest('hex').slice(0, 32);
}

export function parseClientMeta(req) {
  const userAgent = req.headers['user-agent'] || null;
  const clientVersion = req.headers['x-dtunnel-version'] || null;
  const clientId = req.headers['x-dtunnel-client'] || null;
  return {
    userAgent,
    clientVersion,
    clientId,
    fingerprintHash: buildFingerprintHash({ userAgent, clientVersion, clientId }),
  };
}
