export const THREAT_RULES = [
  {
    id: 'sqli',
    severity: 'high',
    label: 'Inyección SQL',
    pattern: /(\bunion\b[\s\S]{0,40}\bselect\b|\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+|';?\s*--|information_schema)/i,
  },
  {
    id: 'path_traversal',
    severity: 'high',
    label: 'Path traversal',
    pattern: /(\.\.(\/|\\|%2f|%5c)|%2e%2e)/i,
  },
  {
    id: 'env_probe',
    severity: 'medium',
    label: 'Sondeo de archivos sensibles',
    pattern: /\/(\.env|\.git|wp-config\.php|\.aws\/credentials|id_rsa)(\/|$|\?)/i,
  },
  {
    id: 'shell_injection',
    severity: 'critical',
    label: 'Inyección de shell',
    pattern: /(;|\||`|\$\()\s*(cat|wget|curl|bash|sh|nc|powershell)\b/i,
  },
  {
    id: 'xss',
    severity: 'medium',
    label: 'XSS',
    pattern: /(<script[\s>]|javascript:|onerror\s*=|onload\s*=)/i,
  },
  {
    id: 'dtunnel_admin_probe',
    severity: 'critical',
    label: 'Sondeo del panel dtunnel',
    pattern: /\/api\/admin\b|\/admin\/ws\b|jwt\.secret|dtunnel\.db/i,
  },
  {
    id: 'scanner_bot',
    severity: 'low',
    label: 'Escaneo automatizado',
    pattern: /(nikto|sqlmap|nmap|masscan|acunetix|dirbuster)/i,
  },
];

const DEFAULT_REMEDIATION = [
  'Tu IP fue bloqueada por actividad sospechosa detectada en tráfico de túnel.',
  'Para solicitar desbloqueo: escribe a abuse@desarrollado.com indicando tu IP, hora del incidente y uso legítimo.',
  'Los bloqueos automáticos suelen expirar en 7 días si no hay reincidencia.',
  'Evita escanear rutas sensibles (.env, .git) y no envíes payloads de prueba por túneles ajenos.',
].join(' ');

export function getDefaultRemediation() {
  return DEFAULT_REMEDIATION;
}

export function scanHttpRequest({ method = 'GET', path = '/', headers = {} } = {}) {
  const headerBlob = Object.entries(headers)
    .map(([k, v]) => `${k}:${Array.isArray(v) ? v.join(',') : v}`)
    .join('\n');
  const haystack = `${method} ${path}\n${headerBlob}`;
  const matches = [];
  for (const rule of THREAT_RULES) {
    if (rule.pattern.test(haystack)) {
      matches.push({
        id: rule.id,
        severity: rule.severity,
        label: rule.label,
      });
    }
  }
  return matches;
}

export function highestSeverity(matches = []) {
  const order = { critical: 4, high: 3, medium: 2, low: 1 };
  let best = null;
  for (const m of matches) {
    if (!best || (order[m.severity] || 0) > (order[best.severity] || 0)) best = m;
  }
  return best;
}
