import { API_BASE, TUNNEL_DOMAIN } from './config.js';

const token = localStorage.getItem('dtunnel_token');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let securityTab = 'audit';
let securityData = null;

const TUTORIALS = [
  {
    id: 'audit-ip',
    title: '1. Auditar IP de creador de túnel',
    description: 'Comprueba si la IP que abrió un túnel está en lista negra y qué debe hacer el usuario.',
    steps: [
      {
        text: 'Listamos túneles activos con metadatos de red y dispositivo.',
        input: 'GET /admin/security/tunnel-creators',
        output: `{
  "creators": [{
    "subdomain": "mi-api",
    "clientIp": "203.0.113.44",
    "fingerprintHash": "a3f2…",
    "blacklist": null,
    "risk": "low"
  }]
}`,
      },
      {
        text: 'Si blacklist no es null, mostramos motivo y pasos de remediación.',
        input: 'GET /admin/security/ip-blacklist?q=203.0.113.44',
        output: `{
  "entries": [{
    "ip": "203.0.113.44",
    "reason": "Sondeo de archivos sensibles",
    "remediation": "Contacta abuse@desarrollado.com…"
  }]
}`,
      },
    ],
  },
  {
    id: 'block-threat',
    title: '2. Bloquear IP tras amenaza detectada',
    description: 'Cuando el escáner detecta SQLi o sondeo del panel, puedes bloquear y cerrar túneles.',
    steps: [
      {
        text: 'Revisamos eventos de abuso de las últimas 24 h.',
        input: 'GET /admin/security/abuse-events?severity=critical',
        output: `{ "events": [{ "eventType": "dtunnel_admin_probe", "ip": "198.51.100.9" }] }`,
      },
      {
        text: 'Bloqueamos la IP y cerramos túneles anónimos asociados.',
        input: 'POST /admin/security/block-ip\n{ "ip": "198.51.100.9", "reason": "Sondeo admin", "closeTunnels": true }',
        output: `{ "entry": { "ip": "198.51.100.9" }, "closedTunnels": 2 }`,
      },
    ],
  },
  {
    id: 'whitelist-office',
    title: '3. Añadir IP de oficina a lista blanca',
    description: 'Las IPs en lista blanca omiten rate limits y pueden omitir bloqueos si está activado.',
    steps: [
      {
        text: 'Registramos la IP corporativa con etiqueta.',
        input: 'POST /admin/security/ip-whitelist\n{ "ip": "203.0.113.10", "label": "Oficina BOG" }',
        output: `{ "ip": "203.0.113.10", "bypassRateLimit": true }`,
      },
    ],
  },
  {
    id: 'workspace-tunnel',
    title: '4. Probar túnel desde Workspace',
    description: 'En Workspace dtunnel creas un server.js y simulas dtunnel --port 3000.',
    steps: [
      {
        text: 'Inicia un servidor local en el IDE (plantilla incluida).',
        input: 'node server.js',
        output: 'Listening on http://127.0.0.1:3000',
      },
      {
        text: 'Abre el túnel público (en tu máquina real usarías el CLI).',
        input: 'dtunnel --port 3000',
        output: `https://abc12345.${TUNNEL_DOMAIN}`,
      },
    ],
  },
];

async function secApi(path, options = {}) {
  const res = await fetch(`${API_BASE}/admin/security${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString('es');
}

function riskBadge(risk) {
  const labels = { low: 'Bajo', medium: 'Medio', high: 'Alto', blocked: 'Bloqueado' };
  return `<span class="ws-risk-${risk}">${labels[risk] || risk}</span>`;
}

function severityBadge(s) {
  const map = { critical: 'error', high: 'error', medium: 'default', low: 'ok' };
  return `<span class="badge badge-${map[s] || 'default'}">${esc(s)}</span>`;
}

export function initSecurityPanel({ toast }) {
  document.getElementById('security-refresh')?.addEventListener('click', () => loadSecurity({ toast }));
  document.querySelectorAll('[data-sec-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      securityTab = btn.dataset.secTab;
      document.querySelectorAll('[data-sec-tab]').forEach((b) => b.classList.toggle('active', b.dataset.secTab === securityTab));
      document.querySelectorAll('.ws-sec-pane').forEach((p) => {
        const on = p.id === `security-tab-${securityTab}`;
        p.hidden = !on;
        p.classList.toggle('active', on);
      });
      renderSecurityTab({ toast });
    });
  });
  document.getElementById('security-tab-blacklist')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-block-ip]');
    if (btn) removeBlacklist(btn.dataset.blockIp, { toast });
  });
}

export async function loadSecurity({ toast }) {
  try {
    securityData = await secApi('/overview');
    renderSecurityTab({ toast });
  } catch (err) {
    toast?.(err.message, 'error');
  }
}

function renderSecurityTab({ toast }) {
  if (!securityData && securityTab !== 'tutorials') return;
  const fns = {
    audit: renderAuditTab,
    blacklist: renderBlacklistTab,
    whitelist: renderWhitelistTab,
    threats: renderThreatsTab,
    devices: renderDevicesTab,
    tutorials: renderTutorialsTab,
  };
  fns[securityTab]?.({ toast });
}

function renderAuditTab() {
  const el = document.getElementById('security-tab-audit');
  if (!el || !securityData) return;
  const { stats, tunnelCreators, recentThreats } = securityData;
  el.innerHTML = `
    <div class="ws-console-stats">
      <article class="ws-stat"><div class="ws-stat-label">IPs bloqueadas</div><div class="ws-stat-value">${stats.blacklistedIps}</div></article>
      <article class="ws-stat"><div class="ws-stat-label">Lista blanca</div><div class="ws-stat-value">${stats.whitelistedIps}</div></article>
      <article class="ws-stat"><div class="ws-stat-label">Amenazas (24 h)</div><div class="ws-stat-value">${stats.abuseLast24h}</div></article>
      <article class="ws-stat"><div class="ws-stat-label">Críticas (24 h)</div><div class="ws-stat-value">${stats.criticalLast24h}</div></article>
      <article class="ws-stat"><div class="ws-stat-label">Dispositivos</div><div class="ws-stat-value">${stats.trackedDevices}</div></article>
    </div>
    <h2 style="margin:1.25rem 0 0.5rem;font-size:1rem">Creadores de túneles (auditoría IP)</h2>
    <div class="table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>Túnel</th><th>Usuario</th><th>IP</th><th>Dispositivo</th><th>Riesgo</th><th>Lista negra</th><th>Acciones</th>
        </tr></thead>
        <tbody>
          ${tunnelCreators.length ? tunnelCreators.map((c) => `
            <tr>
              <td><code>${esc(c.subdomain)}</code> :${c.port}</td>
              <td>${c.email ? esc(c.email) : '<em>anónimo</em>'}</td>
              <td><code>${esc(c.clientIp || '—')}</code></td>
              <td class="log-details" title="${esc(c.userAgent || '')}">
                <code>${esc((c.fingerprintHash || '—').slice(0, 10))}…</code>
                ${c.clientVersion ? `<br><small>${esc(c.clientVersion)}</small>` : ''}
              </td>
              <td>${riskBadge(c.risk)}</td>
              <td>${c.blacklist
    ? `<strong class="ws-risk-blocked">Sí</strong><div class="ws-remediation-box">${esc(c.blacklist.reason)}<br><em>${esc(c.blacklist.remediation || '')}</em></div>`
    : (c.whitelist ? '<span class="ws-risk-low">Lista blanca</span>' : 'No')}</td>
              <td>${c.clientIp ? `<button type="button" class="btn btn-ghost btn-sm" data-sec-block="${esc(c.clientIp)}">Bloquear IP</button>` : '—'}</td>
            </tr>
          `).join('') : '<tr><td colspan="7" class="empty-cell">Sin túneles activos</td></tr>'}
        </tbody>
      </table>
    </div>
    <h2 style="margin:1.25rem 0 0.5rem;font-size:1rem">Amenazas recientes</h2>
    <div class="table-wrap">
      <table class="admin-table">
        <thead><tr><th>Fecha</th><th>Severidad</th><th>Tipo</th><th>IP</th><th>Subdominio</th><th>Detalle</th></tr></thead>
        <tbody>
          ${recentThreats.length ? recentThreats.map((e) => `
            <tr>
              <td>${fmtDate(e.createdAt)}</td>
              <td>${severityBadge(e.severity)}</td>
              <td><code>${esc(e.eventType)}</code></td>
              <td><code>${esc(e.ip || '—')}</code></td>
              <td><code>${esc(e.subdomain || '—')}</code></td>
              <td class="log-details">${esc(JSON.stringify(e.details || {}))}</td>
            </tr>
          `).join('') : '<tr><td colspan="6" class="empty-cell">Sin eventos</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  el.querySelectorAll('[data-sec-block]').forEach((btn) => {
    btn.addEventListener('click', () => promptBlockIp(btn.dataset.secBlock, { toast: window.__dtunnelToast }));
  });
}

async function renderBlacklistTab({ toast }) {
  const el = document.getElementById('security-tab-blacklist');
  if (!el) return;
  el.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const data = await secApi('/ip-blacklist?limit=100');
    el.innerHTML = `
      <div class="ws-table-toolbar">
        <form id="sec-blacklist-form" class="ws-table-filters" style="flex-wrap:wrap">
          <input name="ip" class="admin-search" placeholder="IP" required>
          <input name="reason" class="admin-search" placeholder="Motivo" required style="min-width:200px">
          <input name="remediation" class="admin-search" placeholder="Cómo salir de la lista (opcional)" style="min-width:240px">
          <select name="scope" class="admin-select"><option value="all">Todo</option><option value="tunnel">Solo túneles</option><option value="api">Solo API</option></select>
          <button type="submit" class="btn btn-primary btn-sm">Añadir</button>
        </form>
      </div>
      <p class="admin-subtitle">${data.total} entrada(s) en lista negra</p>
      <div class="table-wrap"><table class="admin-table"><thead><tr>
        <th>IP</th><th>Alcance</th><th>Motivo</th><th>Remediación</th><th>Origen</th><th>Expira</th><th></th>
      </tr></thead><tbody>
        ${data.entries.map((e) => `
          <tr>
            <td><code>${esc(e.ip)}</code></td>
            <td>${esc(e.scope)}</td>
            <td>${esc(e.reason)}</td>
            <td class="log-details">${esc(e.remediation || '—')}</td>
            <td>${esc(e.source)}</td>
            <td>${e.expiresAt ? fmtDate(e.expiresAt) : '—'}</td>
            <td><button type="button" class="btn btn-ghost btn-sm" data-rm-bl="${e.id}">Quitar</button></td>
          </tr>
        `).join('') || '<tr><td colspan="7" class="empty-cell">Lista vacía</td></tr>'}
      </tbody></table></div>
    `;
    el.querySelector('#sec-blacklist-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await secApi('/ip-blacklist', {
          method: 'POST',
          body: JSON.stringify({
            ip: fd.get('ip'),
            reason: fd.get('reason'),
            remediation: fd.get('remediation') || undefined,
            scope: fd.get('scope'),
          }),
        });
        toast?.('IP añadida a lista negra');
        renderBlacklistTab({ toast });
        loadSecurity({ toast });
      } catch (err) { toast?.(err.message, 'error'); }
    });
    el.querySelectorAll('[data-rm-bl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await secApi(`/ip-blacklist/${btn.dataset.rmBl}`, { method: 'DELETE' });
        toast?.('Entrada eliminada');
        renderBlacklistTab({ toast });
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

async function renderWhitelistTab({ toast }) {
  const el = document.getElementById('security-tab-whitelist');
  if (!el) return;
  el.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const data = await secApi('/ip-whitelist?limit=100');
    el.innerHTML = `
      <div class="ws-table-toolbar">
        <form id="sec-whitelist-form" class="ws-table-filters">
          <input name="ip" class="admin-search" placeholder="IP" required>
          <input name="label" class="admin-search" placeholder="Etiqueta (oficina, VPN…)">
          <label><input type="checkbox" name="bypassBlacklist"> Omitir lista negra</label>
          <button type="submit" class="btn btn-primary btn-sm">Añadir</button>
        </form>
      </div>
      <div class="table-wrap"><table class="admin-table"><thead><tr>
        <th>IP</th><th>Etiqueta</th><th>Rate limit</th><th>Anónimos</th><th>Omitir negra</th><th></th>
      </tr></thead><tbody>
        ${data.entries.map((e) => `
          <tr>
            <td><code>${esc(e.ip)}</code></td>
            <td>${esc(e.label || '—')}</td>
            <td>${e.bypassRateLimit ? 'Sí' : 'No'}</td>
            <td>${e.bypassAnonLimit ? 'Sí' : 'No'}</td>
            <td>${e.bypassBlacklist ? 'Sí' : 'No'}</td>
            <td><button type="button" class="btn btn-ghost btn-sm" data-rm-wl="${e.id}">Quitar</button></td>
          </tr>
        `).join('') || '<tr><td colspan="6" class="empty-cell">Lista vacía</td></tr>'}
      </tbody></table></div>
    `;
    el.querySelector('#sec-whitelist-form')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await secApi('/ip-whitelist', {
          method: 'POST',
          body: JSON.stringify({
            ip: fd.get('ip'),
            label: fd.get('label') || null,
            bypassBlacklist: fd.get('bypassBlacklist') === 'on',
          }),
        });
        toast?.('IP en lista blanca');
        renderWhitelistTab({ toast });
      } catch (err) { toast?.(err.message, 'error'); }
    });
    el.querySelectorAll('[data-rm-wl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await secApi(`/ip-whitelist/${btn.dataset.rmWl}`, { method: 'DELETE' });
        renderWhitelistTab({ toast });
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

async function renderThreatsTab({ toast }) {
  const el = document.getElementById('security-tab-threats');
  if (!el) return;
  try {
    const data = await secApi('/abuse-events?limit=80');
    el.innerHTML = `
      <p class="admin-subtitle">Tráfico sospechoso detectado en túneles (SQLi, path traversal, sondeo del panel dtunnel, etc.). Tras 3 eventos/hora o severidad crítica → bloqueo automático de IP.</p>
      <div class="table-wrap"><table class="admin-table"><thead><tr>
        <th>Fecha</th><th>Severidad</th><th>Tipo</th><th>IP</th><th>Subdominio</th><th>Dispositivo</th><th>Acción</th><th></th>
      </tr></thead><tbody>
        ${data.events.map((e) => `
          <tr>
            <td>${fmtDate(e.createdAt)}</td>
            <td>${severityBadge(e.severity)}</td>
            <td><code>${esc(e.eventType)}</code></td>
            <td><code>${esc(e.ip || '—')}</code></td>
            <td><code>${esc(e.subdomain || '—')}</code></td>
            <td><code title="${esc(e.userAgent || '')}">${esc((e.fingerprintHash || '—').slice(0, 8))}…</code></td>
            <td>${esc(e.actionTaken)}${e.blocked ? ' 🚫' : ''}</td>
            <td>${e.ip ? `<button type="button" class="btn btn-ghost btn-sm" data-sec-block="${esc(e.ip)}">Bloquear</button>` : ''}</td>
          </tr>
        `).join('') || '<tr><td colspan="8" class="empty-cell">Sin amenazas registradas</td></tr>'}
      </tbody></table></div>
    `;
    el.querySelectorAll('[data-sec-block]').forEach((btn) => {
      btn.addEventListener('click', () => promptBlockIp(btn.dataset.secBlock, { toast }));
    });
  } catch (err) {
    el.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

async function renderDevicesTab({ toast }) {
  const el = document.getElementById('security-tab-devices');
  if (!el) return;
  try {
    const data = await secApi('/devices?limit=80');
    el.innerHTML = `
      <p class="admin-subtitle">Huella por User-Agent + versión CLI + ID de cliente. Útil para correlacionar abusos entre IPs.</p>
      <div class="table-wrap"><table class="admin-table"><thead><tr>
        <th>Huella</th><th>Usuario</th><th>IP reciente</th><th>CLI</th><th>Client ID</th><th>Túneles</th><th>Estado</th><th></th>
      </tr></thead><tbody>
        ${data.devices.map((d) => `
          <tr>
            <td><code>${esc(d.fingerprintHash)}</code></td>
            <td>${d.email ? esc(d.email) : '—'}</td>
            <td><code>${esc(d.clientIp || '—')}</code></td>
            <td>${esc(d.clientVersion || '—')}</td>
            <td><code>${esc(d.clientId || '—')}</code></td>
            <td>${d.tunnelCount}</td>
            <td>${d.blocked ? '<span class="ws-risk-blocked">Bloqueado</span>' : 'OK'}</td>
            <td><button type="button" class="btn btn-ghost btn-sm" data-toggle-dev="${esc(d.fingerprintHash)}" data-blocked="${d.blocked ? '1' : '0'}">${d.blocked ? 'Desbloquear' : 'Bloquear'}</button></td>
          </tr>
        `).join('') || '<tr><td colspan="8" class="empty-cell">Sin dispositivos</td></tr>'}
      </tbody></table></div>
    `;
    el.querySelectorAll('[data-toggle-dev]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const hash = btn.dataset.toggleDev;
        const blocked = btn.dataset.blocked !== '1';
        await secApi(`/devices/${encodeURIComponent(hash)}/block`, {
          method: 'POST',
          body: JSON.stringify({ blocked }),
        });
        toast?.(blocked ? 'Dispositivo bloqueado' : 'Dispositivo desbloqueado');
        renderDevicesTab({ toast });
      });
    });
  } catch (err) {
    el.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

function renderTutorialsTab() {
  const el = document.getElementById('security-tab-tutorials');
  if (!el) return;
  el.innerHTML = TUTORIALS.map((t, ti) => `
    <article class="ws-tutorial-card" data-tutorial="${t.id}">
      <h3>${esc(t.title)}</h3>
      <p>${esc(t.description)}</p>
      <div class="ws-tutorial-steps" id="tutorial-steps-${ti}"></div>
      <div class="ws-quick-actions" style="margin-top:0.75rem">
        <button type="button" class="btn btn-ghost btn-sm" data-tut-prev="${ti}" disabled>Anterior</button>
        <button type="button" class="btn btn-primary btn-sm" data-tut-next="${ti}">Siguiente paso</button>
        <span class="admin-subtitle" data-tut-progress="${ti}">Paso 1 / ${t.steps.length}</span>
      </div>
    </article>
  `).join('');

  const stepIndex = new Map(TUTORIALS.map((_, i) => [i, 0]));

  function paintStep(ti) {
    const t = TUTORIALS[ti];
    const si = stepIndex.get(ti) || 0;
    const step = t.steps[si];
    const box = document.getElementById(`tutorial-steps-${ti}`);
    if (!box || !step) return;
    box.innerHTML = `
      <p>${esc(step.text)}</p>
      <div class="ws-tutorial-terminal"><span class="in">$ ${esc(step.input)}</span>\n<span class="out">${esc(step.output)}</span></div>
    `;
    document.querySelector(`[data-tut-prev="${ti}"]`).disabled = si === 0;
    document.querySelector(`[data-tut-next="${ti}"]`).textContent = si >= t.steps.length - 1 ? 'Reiniciar' : 'Siguiente paso';
    document.querySelector(`[data-tut-progress="${ti}"]`).textContent = `Paso ${si + 1} / ${t.steps.length}`;
  }

  TUTORIALS.forEach((_, ti) => {
    paintStep(ti);
    document.querySelector(`[data-tut-next="${ti}"]`)?.addEventListener('click', () => {
      const t = TUTORIALS[ti];
      let si = stepIndex.get(ti) || 0;
      si = si >= t.steps.length - 1 ? 0 : si + 1;
      stepIndex.set(ti, si);
      paintStep(ti);
    });
    document.querySelector(`[data-tut-prev="${ti}"]`)?.addEventListener('click', () => {
      let si = stepIndex.get(ti) || 0;
      si = Math.max(0, si - 1);
      stepIndex.set(ti, si);
      paintStep(ti);
    });
  });
}

async function promptBlockIp(ip, { toast }) {
  const reason = window.prompt(`Motivo para bloquear ${ip}:`, 'Actividad sospechosa');
  if (!reason) return;
  try {
    await secApi('/block-ip', {
      method: 'POST',
      body: JSON.stringify({ ip, reason, closeTunnels: true }),
    });
    toast?.(`IP ${ip} bloqueada`);
    loadSecurity({ toast });
  } catch (err) {
    toast?.(err.message, 'error');
  }
}

async function removeBlacklist(id, { toast }) {
  await secApi(`/ip-blacklist/${id}`, { method: 'DELETE' });
  toast?.('Eliminado');
}
