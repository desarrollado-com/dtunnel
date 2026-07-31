import { API_BASE, MAIN_SITE, TUNNEL_DOMAIN, WS_CONSOLE_URL, WS_METRICS_URL } from './config.js';
import { initSecurityPanel, loadSecurity } from './security.js';
import { initWorkspace, loadWorkspace } from './workspace.js';

const token = localStorage.getItem('dtunnel_token');
if (!token) window.location.href = '/login.html';

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const ROUTES = {
  overview: { title: 'Panel', section: 'General', icon: 'dashboard' },
  console: { title: 'Consola en vivo', section: 'General', icon: 'terminal' },
  analytics: { title: 'Analítica', section: 'General', icon: 'monitoring' },
  health: { title: 'Sistema', section: 'General', icon: 'health_and_safety' },
  organizations: { title: 'Organizaciones', section: 'Gestión', icon: 'corporate_fare' },
  plans: { title: 'Planes', section: 'Facturación', icon: 'sell' },
  coupons: { title: 'Cupones', section: 'Facturación', icon: 'confirmation_number' },
  subscriptions: { title: 'Suscripciones', section: 'Facturación', icon: 'payments' },
  users: { title: 'Usuarios', section: 'Gestión', icon: 'group' },
  tunnels: { title: 'Túneles', section: 'Red', icon: 'hub' },
  anonymous: { title: 'Anónimos', section: 'Red', icon: 'visibility_off' },
  subdomains: { title: 'Subdominios', section: 'Red', icon: 'dns' },
  traces: { title: 'Trazas HTTP', section: 'Red', icon: 'receipt_long' },
  security: { title: 'Seguridad', section: 'Seguridad', icon: 'shield' },
  workspace: { title: 'Workspace', section: 'Seguridad', icon: 'code' },
  logs: { title: 'Auditoría', section: 'Seguridad', icon: 'history' },
  roles: { title: 'Roles y permisos', section: 'Seguridad', icon: 'shield_person' },
  settings: { title: 'Ajustes', section: 'Sistema', icon: 'settings' },
};

const PAGE_SIZE = 25;
let plansCache = [];
let tunnelsCache = [];
let subdomainsCache = [];
let logsCache = [];
let tracesCache = [];
let rolesCache = [];
let permissionsCache = [];
let couponsCache = [];
let usersCache = [];
let currentRoute = 'overview';
let metricsSocket = null;
let consoleSocket = null;
let consolePaused = false;
let consoleFilter = 'all';
const MAX_CONSOLE_LINES = 500;
let latestMetrics = null;

function parseJwt(tok) {
  try {
    return JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

function isImpersonating() {
  return Boolean(parseJwt(token)?.imp);
}

async function apiAuth(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function renderLineChart(container, history, key, color = 'var(--md-sys-color-primary)') {
  if (!container || !history?.length) return;
  const values = history.map((h) => h[key] ?? 0);
  const max = Math.max(1, ...values);
  const w = Math.max(300, container.clientWidth || 400);
  const h = 140;
  const step = w / Math.max(history.length - 1, 1);
  const points = values.map((v, i) => `${i * step},${h - 12 - (v / max) * (h - 24)}`).join(' ');
  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px">
      <polyline fill="none" stroke="${color}" stroke-width="2" points="${points}" />
    </svg>
  `;
}

function updateLiveStats(payload) {
  latestMetrics = payload;
  const el = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.textContent = val;
  };
  if (!payload?.stats) return;
  el('live-tunnels', payload.stats.activeTunnels);
  el('live-anon', payload.stats.anonTunnels);
  el('live-audit-hour', payload.stats.auditLastHour ?? 0);
  const chart = document.getElementById('overview-live-chart');
  if (chart && payload.history) renderLineChart(chart, payload.history, 'activeTunnels', 'var(--md-sys-color-tertiary)');
}

function connectMetricsWs() {
  if (isImpersonating() || metricsSocket) return;
  const dot = document.getElementById('live-indicator');
  try {
    metricsSocket = new WebSocket(`${WS_METRICS_URL}?token=${encodeURIComponent(token)}`);
    metricsSocket.onopen = () => dot?.classList.remove('offline');
    metricsSocket.onclose = () => {
      dot?.classList.add('offline');
      metricsSocket = null;
      setTimeout(connectMetricsWs, 8000);
    };
    metricsSocket.onerror = () => metricsSocket?.close();
    metricsSocket.onmessage = (ev) => {
      try {
        updateLiveStats(JSON.parse(ev.data));
      } catch { /* ignore */ }
    };
  } catch {
    dot?.classList.add('offline');
  }
}

function fmtConsoleTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString('es', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}

function updateConsoleStats(payload) {
  latestMetrics = payload;
  const el = (id, val) => {
    const node = document.getElementById(id);
    if (node) node.textContent = val;
  };
  if (!payload?.stats) return;
  el('console-stat-tunnels', payload.stats.activeTunnels ?? '—');
  el('console-stat-anon', payload.stats.anonTunnels ?? '—');
  el('console-stat-users', payload.stats.users ?? '—');
  el('console-stat-audit', payload.stats.auditLastHour ?? 0);
  const chart = document.getElementById('console-chart');
  if (chart && payload.history) renderLineChart(chart, payload.history, 'activeTunnels');
}

function consoleMatchesFilter(kind) {
  if (consoleFilter === 'all') return true;
  return consoleFilter === kind;
}

function pruneConsoleFeed() {
  const feed = document.getElementById('console-feed');
  if (!feed) return;
  while (feed.children.length > MAX_CONSOLE_LINES) feed.removeChild(feed.firstChild);
}

function appendConsoleLine(kind, html) {
  if (!consoleMatchesFilter(kind)) return;
  const feed = document.getElementById('console-feed');
  if (!feed) return;
  const line = document.createElement('div');
  line.className = 'ws-console-line';
  line.dataset.kind = kind;
  line.innerHTML = html;
  feed.appendChild(line);
  pruneConsoleFeed();
  if (!consolePaused) feed.scrollTop = feed.scrollHeight;
}

function renderConsoleTraceLine(trace) {
  const status = trace.status;
  const tagClass = status >= 400 ? 'ws-console-tag-warn' : 'ws-console-tag-ok';
  const who = trace.email ? escapeHtml(trace.email) : '<em>anónimo</em>';
  const dur = trace.durationMs != null ? ` · ${trace.durationMs} ms` : '';
  return `
    <span class="ws-console-time">${fmtConsoleTime(trace.createdAt)}</span>
    <span class="ws-console-tag ws-console-tag-trace">HTTP</span>
    <span class="ws-console-tag ${tagClass}">${trace.status ?? '—'}</span>
    <span class="ws-console-msg"><code>${escapeHtml(trace.method)}</code> ${escapeHtml(trace.path)} · <code>${escapeHtml(trace.subdomain)}</code> · ${who}${dur}</span>
  `;
}

function renderConsoleAuditLine(log) {
  const target = log.targetType ? `${log.targetType}:${log.targetId || '—'}` : '';
  const actor = log.actorEmail ? escapeHtml(log.actorEmail) : '<em>sistema</em>';
  return `
    <span class="ws-console-time">${fmtConsoleTime(log.createdAt)}</span>
    <span class="ws-console-tag ws-console-tag-audit">AUDIT</span>
    <span class="ws-console-msg"><code>${escapeHtml(log.action)}</code> · ${actor}${target ? ` · ${escapeHtml(target)}` : ''}${log.ip ? ` · ${escapeHtml(log.ip)}` : ''}</span>
  `;
}

function clearConsoleFeed() {
  const feed = document.getElementById('console-feed');
  if (feed) feed.innerHTML = '';
}

function applyConsoleFilter() {
  const feed = document.getElementById('console-feed');
  if (!feed) return;
  feed.querySelectorAll('.ws-console-line').forEach((line) => {
    line.hidden = !consoleMatchesFilter(line.dataset.kind);
  });
}

function handleConsoleMessage(msg) {
  if (!msg?.type) return;
  if (msg.type === 'init') {
    clearConsoleFeed();
    if (msg.metrics) updateConsoleStats(msg.metrics);
    const items = [
      ...(msg.audits || []).map((log) => ({ kind: 'audit', at: log.createdAt, data: log })),
      ...(msg.traces || []).map((trace) => ({ kind: 'trace', at: trace.createdAt, data: trace })),
    ];
    items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    items.forEach((item) => {
      if (item.kind === 'trace') appendConsoleLine('trace', renderConsoleTraceLine(item.data));
      else appendConsoleLine('audit', renderConsoleAuditLine(item.data));
    });
    return;
  }
  if (msg.type === 'metrics') {
    updateConsoleStats(msg);
    return;
  }
  if (msg.type === 'trace' && msg.trace) {
    appendConsoleLine('trace', renderConsoleTraceLine(msg.trace));
    return;
  }
  if (msg.type === 'audit' && msg.log) {
    appendConsoleLine('audit', renderConsoleAuditLine(msg.log));
  }
}

function setConsoleLiveState(connected, label) {
  const dot = document.getElementById('console-live-indicator');
  if (!dot) return;
  dot.textContent = label || (connected ? 'En vivo' : 'Desconectado');
  dot.classList.toggle('offline', !connected);
}

function connectConsoleWs() {
  if (isImpersonating() || consoleSocket || currentRoute !== 'console') return;
  setConsoleLiveState(false, 'Conectando…');
  try {
    consoleSocket = new WebSocket(`${WS_CONSOLE_URL}?token=${encodeURIComponent(token)}`);
    consoleSocket.onopen = () => setConsoleLiveState(true);
    consoleSocket.onclose = () => {
      consoleSocket = null;
      setConsoleLiveState(false, 'Desconectado');
      if (currentRoute === 'console') setTimeout(connectConsoleWs, 8000);
    };
    consoleSocket.onerror = () => consoleSocket?.close();
    consoleSocket.onmessage = (ev) => {
      try {
        handleConsoleMessage(JSON.parse(ev.data));
      } catch { /* ignore */ }
    };
  } catch {
    setConsoleLiveState(false, 'Error de conexión');
  }
}

function disconnectConsoleWs() {
  if (!consoleSocket) return;
  consoleSocket.onclose = null;
  consoleSocket.close();
  consoleSocket = null;
  setConsoleLiveState(false, 'Desconectado');
}

function loadConsole() {
  connectConsoleWs();
}

function renderImpersonationBanner() {
  const banner = document.getElementById('impersonation-banner');
  const payload = parseJwt(token);
  if (!payload?.imp) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `
    <span>Viendo como <strong>${escapeHtml(payload.email)}</strong></span>
    <div class="ws-quick-actions">
      <a href="${MAIN_SITE}/dashboard.html" class="btn btn-ghost btn-sm" target="_blank" rel="noopener">Abrir dashboard</a>
      <button type="button" class="btn btn-primary btn-sm" id="stop-impersonate-btn">Salir de impersonación</button>
    </div>
  `;
  document.getElementById('stop-impersonate-btn')?.addEventListener('click', stopImpersonation);
}

async function stopImpersonation() {
  const data = await api('/impersonate/stop', { method: 'POST' });
  if (!data?.token) return;
  localStorage.setItem('dtunnel_token', data.token);
  localStorage.setItem('dtunnel_email', data.email);
  sessionStorage.removeItem('dtunnel_admin_token');
  window.location.reload();
}

async function impersonateUser(userId) {
  if (!confirm('¿Impersonar este usuario? Se registrará en auditoría.')) return;
  const data = await api(`/users/${userId}/impersonate`, { method: 'POST' });
  if (!data?.token) return;
  sessionStorage.setItem('dtunnel_admin_token', token);
  localStorage.setItem('dtunnel_token', data.token);
  localStorage.setItem('dtunnel_email', data.email);
  toast(`Impersonando a ${data.email}`);
  window.location.reload();
}

let usersPage = 0;
let logsPage = 0;
let subscriptionsPage = 0;
let tracesLiveTimer = null;

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}/admin${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }
  if (res.status === 403) {
    toast('No tienes permisos de administrador.', 'error');
    window.location.href = MAIN_SITE;
    return null;
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, kind = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `ws-toast ws-toast-${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

window.__dtunnelToast = toast;

function loadSecurityPanel() {
  loadSecurity({ toast });
}

function loadWorkspacePanel() {
  loadWorkspace({ toast });
}

function badge(text, kind = 'default') {
  return `<span class="badge badge-${kind}">${text}</span>`;
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value.includes('T') ? value : `${value}Z`).toLocaleString('es');
}

function fmtUptime(seconds) {
  const s = Math.floor(seconds || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildNav() {
  const nav = document.getElementById('ws-nav');
  const sections = [...new Set(Object.values(ROUTES).map((r) => r.section))];
  nav.innerHTML = sections.map((section) => {
    const links = Object.entries(ROUTES)
      .filter(([, r]) => r.section === section)
      .map(([id, r]) => `
        <button type="button" class="ws-nav-link" data-route="${id}">
          <span class="material-symbols-outlined">${r.icon}</span>
          ${r.title}
        </button>
      `).join('');
    return `<div class="ws-nav-section"><div class="ws-nav-label">${section}</div>${links}</div>`;
  }).join('');
  nav.addEventListener('click', (e) => {
    const route = e.target.closest('[data-route]')?.dataset.route;
    if (route) navigate(route);
  });
}

function updateBreadcrumb(route) {
  const meta = ROUTES[route];
  document.getElementById('ws-breadcrumb').innerHTML = `
    <span>dtunnel</span>
    <span class="material-symbols-outlined">chevron_right</span>
    <span>${meta.section}</span>
    <span class="material-symbols-outlined">chevron_right</span>
    <strong>${meta.title}</strong>
  `;
}

function setActiveNav(route) {
  document.querySelectorAll('.ws-nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  document.querySelectorAll('.ws-panel').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route || el.id === `panel-${route}`);
  });
}

function navigate(route, { replace = false } = {}) {
  if (!ROUTES[route]) route = 'overview';
  if (currentRoute === 'traces' && route !== 'traces') stopTracesLive();
  if (currentRoute === 'console' && route !== 'console') disconnectConsoleWs();
  currentRoute = route;
  const hash = `#/${route}`;
  if (replace) history.replaceState({ route }, '', hash);
  else if (location.hash !== hash) history.pushState({ route }, '', hash);
  setActiveNav(route);
  updateBreadcrumb(route);
  document.getElementById('ws-sidebar')?.classList.remove('open');
  loadRoute(route);
}

function loadRoute(route) {
  const loaders = {
    overview: loadOverview,
    console: loadConsole,
    analytics: loadAnalytics,
    health: loadHealth,
    users: loadUsers,
    organizations: loadOrganizations,
    plans: loadPlans,
    coupons: loadCoupons,
    subscriptions: loadSubscriptions,
    roles: loadRoles,
    tunnels: loadTunnels,
    anonymous: loadAnonymous,
    subdomains: loadSubdomains,
    traces: loadTraces,
    security: loadSecurityPanel,
    workspace: loadWorkspacePanel,
    logs: loadLogs,
    settings: loadSettings,
  };
  loaders[route]?.();
}

function fillDaySeries(rows, days) {
  const map = new Map(rows.map((r) => [r.day, r.count]));
  const result = [];
  const end = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ day: key, count: map.get(key) || 0 });
  }
  return result;
}

function renderBarChart(container, series, { height = 180 } = {}) {
  const labels = series[0]?.values.map((v) => v.day) || [];
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v.count)));
  const barW = Math.max(4, Math.min(24, (container.clientWidth - 40) / labels.length / series.length - 2));
  const chartH = height - 30;
  const colors = ['var(--md-sys-color-primary)', 'var(--md-sys-color-tertiary)', 'var(--md-sys-color-error)'];
  const groups = labels.map((day, i) => {
    const bars = series.map((s, si) => {
      const count = s.values[i]?.count || 0;
      const h = (count / max) * chartH;
      const x = 30 + i * (barW * series.length + 6) + si * (barW + 1);
      const y = chartH - h + 10;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${colors[si % colors.length]}" opacity="0.9"><title>${day}: ${count}</title></rect>`;
    }).join('');
    return bars;
  }).join('');
  const tickStep = Math.max(1, Math.ceil(labels.length / 7));
  const xLabels = labels.map((day, i) => {
    if (i % tickStep !== 0 && i !== labels.length - 1) return '';
    const x = 30 + i * (barW * series.length + 6) + (barW * series.length) / 2;
    return `<text x="${x}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--md-sys-color-on-surface-variant)">${day.slice(5)}</text>`;
  }).join('');
  container.innerHTML = `
    <svg viewBox="0 0 ${Math.max(300, 30 + labels.length * (barW * series.length + 6))} ${height}" preserveAspectRatio="xMinYMid meet">
      <line x1="28" y1="10" x2="28" y2="${chartH + 10}" stroke="var(--md-sys-color-outline-variant)" stroke-width="1"/>
      <line x1="28" y1="${chartH + 10}" x2="100%" y2="${chartH + 10}" stroke="var(--md-sys-color-outline-variant)" stroke-width="1"/>
      ${groups}
      ${xLabels}
    </svg>
  `;
}

function renderPagination(containerId, { page, total, pageSize, onPage }) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = page + 1;
  el.innerHTML = `
    <span>${total} registro(s) · página ${current} de ${pages}</span>
    <div class="ws-pagination-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-page="prev" ${page <= 0 ? 'disabled' : ''}>Anterior</button>
      <button type="button" class="btn btn-ghost btn-sm" data-page="next" ${current >= pages ? 'disabled' : ''}>Siguiente</button>
    </div>
  `;
  el.onclick = (e) => {
    const action = e.target.dataset.page;
    if (action === 'prev' && page > 0) onPage(page - 1);
    if (action === 'next' && current < pages) onPage(page + 1);
  };
}

function downloadCsv(filename, rows) {
  const blob = new Blob([rows], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadOverview() {
  const panel = document.getElementById('panel-overview');
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  const [stats, analytics, logsData] = await Promise.all([
    api('/stats'),
    api('/analytics?days=14'),
    api('/logs?limit=8'),
  ]);
  if (!stats) return;

  const signupSeries = fillDaySeries(analytics?.signups || [], 14);
  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Panel de control</h1>
        <p>Resumen operativo de dtunnel.</p>
      </div>
      <div class="ws-quick-actions">
        <span class="ws-live-dot" id="live-indicator">En vivo</span>
        <button type="button" class="btn btn-outlined btn-sm" data-goto="users">Usuarios</button>
        <button type="button" class="btn btn-outlined btn-sm" data-goto="tunnels">Túneles</button>
        <button type="button" class="btn btn-outlined btn-sm" data-goto="health">Salud</button>
      </div>
    </div>
    <div class="ws-stat-row">
      <article class="ws-stat">
        <div class="ws-stat-label">Usuarios</div>
        <div class="ws-stat-value">${stats.users}</div>
        <div class="ws-stat-meta">${stats.activeUsers} activos</div>
      </article>
      <article class="ws-stat">
        <div class="ws-stat-label">Túneles activos</div>
        <div class="ws-stat-value">${stats.activeTunnels}</div>
        <div class="ws-stat-meta">${stats.anonTunnels} anónimos</div>
      </article>
      <article class="ws-stat">
        <div class="ws-stat-label">Subdominios</div>
        <div class="ws-stat-value">${stats.reservedSubdomains}</div>
        <div class="ws-stat-meta">reservados</div>
      </article>
      <article class="ws-stat">
        <div class="ws-stat-label">Últimas 24 h</div>
        <div class="ws-stat-value">${analytics?.last24h?.signups ?? 0}</div>
        <div class="ws-stat-meta">${analytics?.last24h?.tunnelOpens ?? 0} túneles abiertos</div>
      </article>
    </div>
    <div class="ws-grid-2">
      <div class="ws-card">
        <h3>Túneles en tiempo real <span class="ws-live-dot" style="font-weight:400">live</span></h3>
        <div class="ws-stat-row" style="margin-bottom:1rem">
          <article class="ws-stat"><div class="ws-stat-label">Activos</div><div class="ws-stat-value" id="live-tunnels">${stats.activeTunnels}</div></article>
          <article class="ws-stat"><div class="ws-stat-label">Anónimos</div><div class="ws-stat-value" id="live-anon">${stats.anonTunnels}</div></article>
          <article class="ws-stat"><div class="ws-stat-label">Eventos (1 h)</div><div class="ws-stat-value" id="live-audit-hour">—</div></article>
        </div>
        <div class="ws-chart" id="overview-live-chart"></div>
      </div>
      <div class="ws-card">
        <h3>Registros (14 días)</h3>
        <div class="ws-chart" id="overview-chart"></div>
        <div class="ws-chart-legend"><span class="ws-legend-primary">Nuevos usuarios</span></div>
      </div>
      <div class="ws-card">
        <h3>Actividad reciente</h3>
        <ul class="ws-recent-list">
          ${(logsData?.logs || []).map((log) => `
            <li>
              <span><code>${escapeHtml(log.action)}</code> · ${escapeHtml(log.actorEmail || 'sistema')}</span>
              <span>${fmtDate(log.createdAt)}</span>
            </li>
          `).join('') || '<li>Sin actividad reciente</li>'}
        </ul>
      </div>
    </div>
  `;
  panel.querySelectorAll('[data-goto]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.goto));
  });
  renderBarChart(panel.querySelector('#overview-chart'), [{
    name: 'signups',
    values: signupSeries.map((d) => ({ day: d.day, count: d.count })),
  }]);
  if (latestMetrics) updateLiveStats(latestMetrics);
}

async function loadAnalytics() {
  const panel = document.getElementById('panel-analytics');
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  const data = await api('/analytics?days=30');
  if (!data) return;

  const days = data.days;
  const signups = fillDaySeries(data.signups, days);
  const opens = fillDaySeries(data.tunnelOpens, days);
  const closes = fillDaySeries(data.tunnelCloses, days);
  const maxPlan = Math.max(1, ...data.planDistribution.map((p) => p.count));

  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Analítica</h1>
        <p>Tendencias de los últimos ${days} días.</p>
      </div>
    </div>
    <div class="ws-grid-2">
      <div class="ws-card">
        <h3>Registros de usuarios</h3>
        <div class="ws-chart" id="analytics-signups"></div>
        <div class="ws-chart-legend"><span class="ws-legend-primary">Registros</span></div>
      </div>
      <div class="ws-card">
        <h3>Eventos de túnel</h3>
        <div class="ws-chart" id="analytics-tunnels"></div>
        <div class="ws-chart-legend">
          <span class="ws-legend-primary">Aperturas</span>
          <span class="ws-legend-tertiary">Cierres</span>
        </div>
      </div>
    </div>
    <div class="ws-grid-2" style="margin-top:1rem">
      <div class="ws-card">
        <h3>Distribución por plan</h3>
        <div class="ws-plan-bars">
          ${data.planDistribution.map((p) => `
            <div class="ws-plan-bar-row">
              <code>${escapeHtml(p.plan)}</code>
              <div class="ws-plan-bar-track"><div class="ws-plan-bar-fill" style="width:${(p.count / maxPlan) * 100}%"></div></div>
              <span>${p.count}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="ws-card">
        <h3>Acciones (24 h)</h3>
        <ul class="ws-recent-list">
          ${data.recentActions.length ? data.recentActions.map((a) => `
            <li><span><code>${escapeHtml(a.action)}</code></span><span>${a.count}</span></li>
          `).join('') : '<li>Sin actividad</li>'}
        </ul>
      </div>
    </div>
  `;
  renderBarChart(panel.querySelector('#analytics-signups'), [{ name: 'signups', values: signups }]);
  renderBarChart(panel.querySelector('#analytics-tunnels'), [
    { name: 'opens', values: opens },
    { name: 'closes', values: closes },
  ]);
}

async function loadHealth() {
  const panel = document.getElementById('panel-health');
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  const data = await api('/health');
  if (!data) return;

  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Estado del sistema</h1>
        <p>Salud de la API y métricas de la plataforma.</p>
      </div>
      <span class="status-pill status-ok">Operativo</span>
    </div>
    <div class="ws-health-grid">
      <div class="ws-card ws-health-item">
        <span class="material-symbols-outlined">info</span>
        <div>
          <strong>API v${escapeHtml(data.version)}</strong>
          <span>Transporte: ${escapeHtml(data.transport)} · uptime ${fmtUptime(data.uptimeSeconds)}</span>
        </div>
      </div>
      <div class="ws-card ws-health-item">
        <span class="material-symbols-outlined">group</span>
        <div>
          <strong>${data.users} usuarios</strong>
          <span>${data.usersUnverified} sin verificar · ${data.usersSuspended} suspendidos</span>
        </div>
      </div>
      <div class="ws-card ws-health-item">
        <span class="material-symbols-outlined">hub</span>
        <div>
          <strong>${data.activeTunnels} túneles activos</strong>
          <span>${data.anonTunnels} anónimos</span>
        </div>
      </div>
      <div class="ws-card ws-health-item">
        <span class="material-symbols-outlined">history</span>
        <div>
          <strong>${data.auditLogCount} eventos de auditoría</strong>
          <span>${data.admins} administradores</span>
        </div>
      </div>
    </div>
    <div class="ws-card" style="margin-top:1rem">
      <h3>Configuración en ejecución</h3>
      <div class="ws-health-grid">
        <div><span class="admin-subtitle">Límite anónimo/IP</span><br><strong>${data.settings?.anonTunnelLimit ?? '—'}</strong></div>
        <div><span class="admin-subtitle">Heartbeat timeout</span><br><strong>${data.settings?.heartbeatTimeoutMin ?? '—'} min</strong></div>
        <div><span class="admin-subtitle">Purga huérfanos</span><br><strong>${data.settings?.staleTunnelHours ?? '—'} h</strong></div>
        <div><span class="admin-subtitle">Última comprobación</span><br><strong>${fmtDate(data.timestamp)}</strong></div>
      </div>
    </div>
  `;
}

async function loadUsers() {
  const q = document.getElementById('users-search').value.trim();
  const plan = document.getElementById('users-plan-filter').value;
  const active = document.getElementById('users-active-filter').value;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(usersPage * PAGE_SIZE),
  });
  if (q) params.set('q', q);
  if (plan) params.set('plan', plan);
  if (active !== '') params.set('active', active);

  const data = await api(`/users?${params}`);
  if (!data) return;
  usersCache = data.users;
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = data.users.length ? data.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.email)}${user.isAdmin ? ` ${badge('admin', 'accent')}` : ''}</td>
      <td>${badge(user.plan)}</td>
      <td>${user.active ? badge('activo', 'ok') : badge('suspendido', 'warn')}</td>
      <td>${user.emailVerified ? badge('sí', 'ok') : badge('pendiente', 'warn')}</td>
      <td>${user.activeTunnelCount} / ${user.tunnelLimit}</td>
      <td>${user.reservedCount} / ${user.reservedSubdomainLimit}</td>
      <td>${fmtDate(user.createdAt)}</td>
      <td class="admin-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-user="${user.id}">Editar</button>
        ${!user.emailVerified ? `<button type="button" class="btn btn-ghost btn-sm" data-send-activation="${user.id}">Activación</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-send-password-reset="${user.id}">Reset</button>
        ${user.activeTunnelCount > 0 ? `<button type="button" class="btn btn-ghost btn-sm" data-close-user-tunnels="${user.id}">Cerrar túneles</button>` : ''}
        ${user.active ? `<button type="button" class="btn btn-ghost btn-sm" data-suspend-user="${user.id}">Suspender</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-impersonate-user="${user.id}">Impersonar</button>
        <button type="button" class="btn btn-ghost btn-sm btn-danger" data-delete-user="${user.id}">Eliminar</button>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="8" class="empty-cell">No hay usuarios</td></tr>';

  renderPagination('users-pagination', {
    page: usersPage,
    total: data.total,
    pageSize: PAGE_SIZE,
    onPage: (p) => { usersPage = p; loadUsers(); },
  });
}

async function loadOrganizations() {
  const panel = document.getElementById('panel-organizations');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  const data = await api('/organizations');
  if (!data) return;
  panel.innerHTML = `
    <div class="ws-page-header"><div><h1>Organizaciones</h1><p>Planes empresariales con varios usuarios.</p></div></div>
    <div class="table-wrap"><table class="admin-table"><thead><tr>
      <th>Nombre</th><th>Slug</th><th>Plan</th><th>Propietario</th><th>Miembros</th><th>Asientos</th><th>Estado</th>
    </tr></thead><tbody>
      ${data.organizations.length ? data.organizations.map((o) => `
        <tr>
          <td>${escapeHtml(o.name)}</td>
          <td><code>${escapeHtml(o.slug)}</code></td>
          <td>${badge(o.plan)}</td>
          <td>${escapeHtml(o.ownerEmail || '—')}</td>
          <td>${o.memberCount}</td>
          <td>${o.seatLimit ?? '—'}</td>
          <td>${o.active ? badge('activa', 'ok') : badge('inactiva', 'warn')}</td>
        </tr>
      `).join('') : '<tr><td colspan="7" class="empty-cell">Sin organizaciones</td></tr>'}
    </tbody></table></div>
  `;
}

function planVisibilityBadge(visibility) {
  return visibility === 'public' ? badge('público', 'ok') : badge('privado', 'default');
}

function fmtMoney(cents, currency = 'USD') {
  if (cents == null) return '—';
  return `${currency} ${(Number(cents) / 100).toFixed(2)}`;
}

async function loadSubscriptions() {
  const q = document.getElementById('subscriptions-search')?.value.trim();
  const status = document.getElementById('subscriptions-status-filter')?.value;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(subscriptionsPage * PAGE_SIZE),
  });
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const data = await api(`/subscriptions?${params}`);
  if (!data) return;
  document.getElementById('subscriptions-meta').textContent = `${data.total} suscripción(es)`;
  const tbody = document.querySelector('#subscriptions-table tbody');
  tbody.innerHTML = data.subscriptions.length ? data.subscriptions.map((s) => `
    <tr>
      <td>${fmtDate(s.createdAt)}</td>
      <td>${s.email ? escapeHtml(s.email) : `id:${s.subscriberId}`}</td>
      <td><code>${escapeHtml(s.planSlug)}</code></td>
      <td>${badge(s.status, s.status === 'active' ? 'ok' : 'warn')}</td>
      <td>${s.billingCycle}</td>
      <td>${fmtMoney(s.amountCents, s.currency)}</td>
      <td class="log-details">${escapeHtml(s.wompiReference || '—')}</td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-cell">Sin suscripciones</td></tr>';
  renderPagination('subscriptions-pagination', {
    page: subscriptionsPage,
    total: data.total,
    pageSize: PAGE_SIZE,
    onPage: (p) => { subscriptionsPage = p; loadSubscriptions(); },
  });
}

async function loadCoupons() {
  const panel = document.getElementById('panel-coupons');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  const data = await api('/coupons');
  if (!data) return;
  couponsCache = data.coupons;
  panel.innerHTML = `
    <div class="ws-page-header">
      <div><h1>Cupones</h1><p>Descuentos para checkout Wompi.</p></div>
      <button type="button" class="btn btn-primary" id="new-coupon-btn">Nuevo cupón</button>
    </div>
    <div class="table-wrap"><table class="admin-table" id="coupons-table"><thead><tr>
      <th>Código</th><th>Tipo</th><th>Valor</th><th>Usos</th><th>Vigencia</th><th>Activo</th><th></th>
    </tr></thead><tbody>
      ${data.coupons.length ? data.coupons.map((c) => `
        <tr>
          <td><code>${escapeHtml(c.code)}</code></td>
          <td>${c.discountType}</td>
          <td>${c.discountValue}${c.discountType === 'percent' ? '%' : ''}</td>
          <td>${c.usesCount}${c.maxUses != null ? ` / ${c.maxUses}` : ''}</td>
          <td>${c.validUntil ? fmtDate(c.validUntil) : '—'}</td>
          <td>${c.active ? badge('sí', 'ok') : badge('no', 'warn')}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-edit-coupon="${c.id}">Editar</button></td>
        </tr>
      `).join('') : '<tr><td colspan="7" class="empty-cell">Sin cupones</td></tr>'}
    </tbody></table></div>
  `;
  document.getElementById('new-coupon-btn')?.addEventListener('click', () => showCouponEditor());
}

function renderPermissionCheckboxes(containerId, permissions, selected = [], { disabled = false } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const selectedSet = new Set(selected);
  const groups = {};
  for (const perm of permissions) {
    const prefix = perm.split('.')[0] || 'other';
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(perm);
  }
  el.innerHTML = Object.entries(groups).map(([prefix, perms]) => perms.map((perm) => `
    <label class="admin-check">
      <input type="checkbox" name="perm" value="${escapeHtml(perm)}" ${selectedSet.has(perm) ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <code>${escapeHtml(perm)}</code>
    </label>
  `).join('')).join('');
}

function getSelectedPermissions(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[name="perm"]:checked`)].map((i) => i.value);
}

function renderUserRoleCheckboxes(roleSlugs = []) {
  const systemRoles = rolesCache.filter((r) => r.scope === 'system');
  const el = document.getElementById('edit-user-roles');
  if (!el) return;
  const selected = new Set(roleSlugs);
  el.innerHTML = systemRoles.length
    ? systemRoles.map((r) => `
      <label class="admin-check">
        <input type="checkbox" name="user-role" value="${escapeHtml(r.slug)}" ${selected.has(r.slug) ? 'checked' : ''}>
        <span>${escapeHtml(r.name)} <code>${escapeHtml(r.slug)}</code></span>
      </label>
    `).join('')
    : '<span class="admin-subtitle">Carga la vista de roles primero.</span>';
}

function showRoleView(role) {
  document.getElementById('role-view-title').textContent = role.name;
  document.getElementById('role-view-meta').textContent =
    `${role.slug} · ámbito: ${role.scope} · ${role.system ? 'rol del sistema' : 'rol personalizado'} · ${role.permissions.length} permiso(s)`;
  document.getElementById('role-view-permissions').innerHTML = role.permissions.length
    ? role.permissions.map((p) => `<code>${escapeHtml(p)}</code>`).join('')
    : '<span class="admin-subtitle">Sin permisos asignados</span>';
  document.getElementById('role-view-dialog').showModal();
}

function showRoleEditor(role = null) {
  const isEdit = Boolean(role);
  document.getElementById('role-dialog-title').textContent = isEdit ? 'Editar rol' : 'Nuevo rol';
  document.getElementById('edit-role-mode').value = isEdit ? 'edit' : 'create';
  document.getElementById('edit-role-slug').value = role?.slug || '';
  document.getElementById('edit-role-slug').disabled = isEdit;
  document.getElementById('edit-role-name').value = role?.name || '';
  document.getElementById('edit-role-scope').value = role?.scope || 'organization';
  document.getElementById('edit-role-scope').disabled = isEdit;
  const isSystem = Boolean(role?.system);
  document.getElementById('role-system-note').hidden = !isSystem;
  renderPermissionCheckboxes(
    'role-permissions-grid',
    permissionsCache,
    role?.permissions || [],
    { disabled: false },
  );
  document.getElementById('role-form-msg').hidden = true;
  document.getElementById('role-dialog').showModal();
}

async function deleteRole(slug) {
  if (!confirm(`¿Eliminar el rol "${slug}"? Los usuarios perderán este rol.`)) return;
  const data = await api(`/roles/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  if (!data) return;
  toast('Rol eliminado');
  loadRoles();
}

async function loadRoles() {
  const panel = document.getElementById('panel-roles');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  const data = await api('/roles');
  if (!data) return;
  rolesCache = data.roles;
  permissionsCache = data.permissions;
  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Roles y permisos</h1>
        <p>RBAC del sistema y organizaciones. Asigna roles a usuarios desde la ficha de usuario.</p>
      </div>
      <button type="button" class="btn btn-primary" id="new-role-btn">Nuevo rol</button>
    </div>
    <div class="table-wrap">
      <table class="admin-table" id="roles-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Slug</th>
            <th>Ámbito</th>
            <th>Permisos</th>
            <th>Tipo</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${data.roles.length ? data.roles.map((r) => `
            <tr>
              <td><strong>${escapeHtml(r.name)}</strong></td>
              <td><code>${escapeHtml(r.slug)}</code></td>
              <td>${badge(r.scope === 'system' ? 'sistema' : 'organización', r.scope === 'system' ? 'accent' : 'default')}</td>
              <td>${r.permissions.length}</td>
              <td>${r.system ? badge('sistema', 'warn') : badge('personalizado', 'ok')}</td>
              <td class="admin-row-actions">
                <button type="button" class="btn btn-ghost btn-sm" data-view-role="${escapeHtml(r.slug)}">Ver</button>
                <button type="button" class="btn btn-ghost btn-sm" data-edit-role="${escapeHtml(r.slug)}">Editar</button>
                ${r.system ? '' : `<button type="button" class="btn btn-ghost btn-sm btn-danger" data-delete-role="${escapeHtml(r.slug)}">Eliminar</button>`}
              </td>
            </tr>
          `).join('') : '<tr><td colspan="6" class="empty-cell">Sin roles</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="ws-card" style="margin-top:1.5rem">
      <h3>Catálogo de permisos</h3>
      <p class="admin-subtitle" style="margin-bottom:0.75rem">Referencia de permisos asignables a roles personalizados.</p>
      <div class="role-permissions-preview">
        ${data.permissions.map((p) => `<code>${escapeHtml(p)}</code>`).join('')}
      </div>
    </div>
  `;
  document.getElementById('new-role-btn')?.addEventListener('click', () => showRoleEditor());
  document.getElementById('roles-table')?.addEventListener('click', (e) => {
    const viewSlug = e.target.dataset.viewRole;
    const editSlug = e.target.dataset.editRole;
    const deleteSlug = e.target.dataset.deleteRole;
    if (viewSlug) showRoleView(rolesCache.find((r) => r.slug === viewSlug));
    if (editSlug) showRoleEditor(rolesCache.find((r) => r.slug === editSlug));
    if (deleteSlug) deleteRole(deleteSlug);
  });
  renderUserRoleCheckboxes();
}

async function loadPlans() {
  const data = await api('/plans');
  if (!data) return;
  plansCache = data.plans;
  const tbody = document.querySelector('#plans-table tbody');
  tbody.innerHTML = data.plans.map((plan) => `
    <tr>
      <td><code>${escapeHtml(plan.slug)}</code></td>
      <td>${escapeHtml(plan.name)}</td>
      <td>${plan.planType === 'enterprise' ? badge('empresa', 'accent') : badge('personal')}</td>
      <td>${planVisibilityBadge(plan.visibility)}</td>
      <td>$${Number(plan.priceMonthly).toFixed(2)} ${plan.currency || 'USD'}</td>
      <td>${plan.tunnelLimit}</td>
      <td>${plan.reservedSubdomainLimit}</td>
      <td>${plan.customSubdomain ? 'Sí' : 'No'}</td>
      <td>${plan.active ? badge('activo', 'ok') : badge('inactivo', 'warn')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-edit-plan="${plan.id}">Editar</button></td>
    </tr>
  `).join('');

  const planOptions = data.plans.filter((p) => p.active).map((plan) => `
    <option value="${plan.slug}">${escapeHtml(plan.name)}</option>
  `).join('');
  document.getElementById('edit-user-plan').innerHTML = planOptions;
  document.getElementById('create-user-plan').innerHTML = planOptions;
  const filter = document.getElementById('users-plan-filter');
  if (filter.options.length <= 1) {
    filter.innerHTML = '<option value="">Todos los planes</option>' + data.plans.map((p) => `
      <option value="${p.slug}">${escapeHtml(p.name)}</option>
    `).join('');
  }
}

async function loadTunnels() {
  const data = await api('/tunnels');
  if (!data) return;
  tunnelsCache = data.tunnels;
  const q = document.getElementById('tunnels-search').value.trim().toLowerCase();
  const filtered = q
    ? data.tunnels.filter((t) =>
      t.subdomain.toLowerCase().includes(q)
      || (t.email || '').toLowerCase().includes(q)
      || (t.clientIp || '').includes(q))
    : data.tunnels;
  const tbody = document.querySelector('#tunnels-table tbody');
  tbody.innerHTML = filtered.length ? filtered.map((tunnel) => `
    <tr>
      <td><a href="https://${tunnel.subdomain}.${TUNNEL_DOMAIN}" target="_blank" rel="noopener">${escapeHtml(tunnel.subdomain)}</a></td>
      <td>${tunnel.port}</td>
      <td>${tunnel.email ? escapeHtml(tunnel.email) : '<em>anónimo</em>'}</td>
      <td>${tunnel.clientIp || '—'}</td>
      <td>${fmtDate(tunnel.lastHeartbeat)}</td>
      <td>${fmtDate(tunnel.createdAt)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-delete-tunnel="${tunnel.id}">Cerrar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="7" class="empty-cell">No hay túneles activos</td></tr>';
}

async function loadAnonymous() {
  const data = await api('/tunnels/anonymous');
  if (!data) return;
  document.getElementById('anonymous-meta').textContent =
    `${data.total} túnel(es) anónimo(s) en ${data.groups.length} IP(s) · límite por IP: ${data.anonTunnelLimit ?? '—'}`;
  const tbody = document.querySelector('#anonymous-table tbody');
  if (!data.groups.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No hay túneles anónimos activos</td></tr>';
    return;
  }
  const rows = [];
  for (const group of data.groups) {
    const ipLabel = group.clientIp || '(sin IP)';
    rows.push(`
      <tr class="anon-ip-header">
        <td colspan="5"><strong>${escapeHtml(ipLabel)}</strong> · ${group.count} túnel(es)</td>
        <td class="admin-actions">
          ${group.clientIp ? `<button type="button" class="btn btn-ghost btn-sm" data-close-anon-ip="${encodeURIComponent(group.clientIp)}">Cerrar IP</button>` : ''}
        </td>
      </tr>
    `);
    for (const tunnel of group.tunnels) {
      rows.push(`
        <tr class="anon-tunnel-row">
          <td class="anon-ip-indent">${escapeHtml(ipLabel)}</td>
          <td><a href="https://${tunnel.subdomain}.${TUNNEL_DOMAIN}" target="_blank" rel="noopener"><code>${escapeHtml(tunnel.subdomain)}</code></a></td>
          <td>${tunnel.port}</td>
          <td>${fmtDate(tunnel.lastHeartbeat)}</td>
          <td>${fmtDate(tunnel.createdAt)}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-delete-tunnel="${tunnel.id}">Cerrar</button></td>
        </tr>
      `);
    }
  }
  tbody.innerHTML = rows.join('');
}

async function loadSubdomains() {
  const data = await api('/subdomains');
  if (!data) return;
  subdomainsCache = data.subdomains;
  const q = document.getElementById('subdomains-search').value.trim().toLowerCase();
  const filtered = q
    ? data.subdomains.filter((s) => s.name.toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q))
    : data.subdomains;
  const tbody = document.querySelector('#subdomains-table tbody');
  tbody.innerHTML = filtered.length ? filtered.map((sub) => `
    <tr>
      <td><a href="https://${sub.name}.${TUNNEL_DOMAIN}" target="_blank" rel="noopener"><code>${escapeHtml(sub.name)}</code></a></td>
      <td>${escapeHtml(sub.email)}</td>
      <td>${sub.tunnelActive ? badge('activo', 'ok') : badge('inactivo', 'warn')}</td>
      <td>${fmtDate(sub.createdAt)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-release-subdomain="${sub.id}" data-sub-name="${escapeHtml(sub.name)}">Liberar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty-cell">No hay subdominios reservados</td></tr>';
}

function httpStatusBadge(status) {
  if (status == null) return badge('—', 'default');
  if (status >= 500) return badge(String(status), 'error');
  if (status >= 400) return badge(String(status), 'warn');
  if (status >= 300) return badge(String(status), 'default');
  return badge(String(status), 'ok');
}

async function loadTraces() {
  const q = document.getElementById('traces-search')?.value.trim();
  const subdomain = document.getElementById('traces-subdomain-filter')?.value.trim();
  const status = document.getElementById('traces-status-filter')?.value;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(tracesPage * PAGE_SIZE),
  });
  if (q) params.set('q', q);
  if (subdomain) params.set('subdomain', subdomain);
  if (status) params.set('status', status);
  const data = await api(`/request-logs?${params}`);
  if (!data) return;
  tracesCache = data.traces;
  document.getElementById('traces-meta').textContent =
    `${data.total} solicitud(es) registrada(s) · retención 14 días`;
  const tbody = document.querySelector('#traces-table tbody');
  tbody.innerHTML = data.traces.length ? data.traces.map((t) => `
    <tr>
      <td>${fmtDate(t.createdAt)}</td>
      <td><code>${escapeHtml(t.method)}</code></td>
      <td class="log-details" title="${escapeHtml(t.path)}">${escapeHtml(t.path)}</td>
      <td>${httpStatusBadge(t.status)}</td>
      <td>${t.durationMs != null ? `${t.durationMs} ms` : '—'}</td>
      <td><code>${escapeHtml(t.subdomain)}</code></td>
      <td>${t.email ? escapeHtml(t.email) : '<em>anónimo</em>'}</td>
      <td>${t.clientIp || '—'}</td>
    </tr>
  `).join('') : '<tr><td colspan="8" class="empty-cell">Sin trazas</td></tr>';

  renderPagination('traces-pagination', {
    page: tracesPage,
    total: data.total,
    pageSize: PAGE_SIZE,
    onPage: (p) => { tracesPage = p; loadTraces(); },
  });
  startTracesLive();
}

function stopTracesLive() {
  if (tracesLiveTimer) {
    clearInterval(tracesLiveTimer);
    tracesLiveTimer = null;
  }
}

function startTracesLive() {
  stopTracesLive();
  if (currentRoute !== 'traces') return;
  if (!document.getElementById('traces-live-toggle')?.checked) return;
  tracesLiveTimer = setInterval(() => {
    if (currentRoute === 'traces' && tracesPage === 0) loadTraces();
  }, 5000);
}

async function loadLogs() {
  const q = document.getElementById('logs-search').value.trim();
  const action = document.getElementById('logs-action-filter').value;
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(logsPage * PAGE_SIZE),
  });
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  const data = await api(`/logs?${params}`);
  if (!data) return;
  logsCache = data.logs;
  document.getElementById('logs-meta').textContent = `${data.total} evento(s) en total`;
  const tbody = document.querySelector('#logs-table tbody');
  tbody.innerHTML = data.logs.length ? data.logs.map((log) => `
    <tr>
      <td>${fmtDate(log.createdAt)}</td>
      <td><code>${escapeHtml(log.action)}</code></td>
      <td>${log.actorEmail ? escapeHtml(log.actorEmail) : '<em>sistema</em>'}</td>
      <td>${log.targetType ? `${log.targetType}:${log.targetId || '—'}` : '—'}</td>
      <td>${log.ip || '—'}</td>
      <td class="log-details">${log.details ? escapeHtml(JSON.stringify(log.details)) : '—'}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="empty-cell">Sin registros</td></tr>';

  renderPagination('logs-pagination', {
    page: logsPage,
    total: data.total,
    pageSize: PAGE_SIZE,
    onPage: (p) => { logsPage = p; loadLogs(); },
  });
}

async function loadSettings() {
  const [data, me] = await Promise.all([api('/settings'), api('/me')]);
  if (!data) return;
  document.getElementById('anon-limit').value = data.anonTunnelLimit;
  document.getElementById('heartbeat-timeout').value = data.heartbeatTimeoutMin;
  document.getElementById('stale-hours').value = data.staleTunnelHours;
  render2faSettings(me?.totp);
}

function render2faSettings(totp = {}) {
  const status = document.getElementById('twofa-status');
  const actions = document.getElementById('twofa-actions');
  const setup = document.getElementById('twofa-setup');
  if (!status || !actions) return;
  setup.hidden = true;
  if (totp?.enabled) {
    status.textContent = '2FA activo en tu cuenta de administrador.';
    actions.innerHTML = `<button type="button" class="btn btn-outlined btn-sm" id="twofa-disable-btn">Desactivar 2FA</button>`;
    document.getElementById('twofa-disable-btn')?.addEventListener('click', async () => {
      const code = prompt('Código 2FA actual:');
      const password = prompt('Tu contraseña:');
      if (!code || !password) return;
      try {
        await apiAuth('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code, password }) });
        toast('2FA desactivado');
        loadSettings();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  } else {
    status.textContent = 'Recomendado para cuentas de administrador.';
    actions.innerHTML = `<button type="button" class="btn btn-primary btn-sm" id="twofa-setup-btn">Configurar 2FA</button>`;
    document.getElementById('twofa-setup-btn')?.addEventListener('click', start2faSetup);
  }
}

async function start2faSetup() {
  try {
    const data = await apiAuth('/auth/2fa/setup', { method: 'POST' });
    document.getElementById('twofa-setup').hidden = false;
    document.getElementById('twofa-qr').src = data.qrUrl;
    document.getElementById('twofa-secret').textContent = data.secret;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function toDatetimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : `${iso}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showCouponEditor(coupon = null) {
  document.getElementById('coupon-dialog-title').textContent = coupon ? 'Editar cupón' : 'Nuevo cupón';
  document.getElementById('edit-coupon-id').value = coupon?.id || '';
  document.getElementById('edit-coupon-code').value = coupon?.code || '';
  document.getElementById('edit-coupon-code').disabled = Boolean(coupon);
  document.getElementById('edit-coupon-description').value = coupon?.description || '';
  document.getElementById('edit-coupon-type').value = coupon?.discountType || 'percent';
  document.getElementById('edit-coupon-value').value = coupon?.discountValue ?? '';
  document.getElementById('edit-coupon-max-uses').value = coupon?.maxUses ?? '';
  document.getElementById('edit-coupon-valid-until').value = toDatetimeLocalValue(coupon?.validUntil);
  document.getElementById('edit-coupon-active').checked = coupon?.active ?? true;
  document.getElementById('coupon-form-msg').hidden = true;
  document.getElementById('coupon-dialog').showModal();
}

async function renderUserPlanGrants(userId) {
  const el = document.getElementById('edit-user-plan-grants');
  const select = document.getElementById('grant-plan-slug');
  if (!el || !select) return;
  const data = await api(`/users/${userId}/plan-access`);
  const grants = data?.grants || [];
  el.innerHTML = grants.length
    ? grants.map((g) => `
      <div style="display:flex;justify-content:space-between;gap:0.5rem;width:100%">
        <span><code>${escapeHtml(g.planSlug)}</code>${g.note ? ` — ${escapeHtml(g.note)}` : ''}</span>
        <button type="button" class="btn btn-ghost btn-sm btn-danger" data-revoke-grant="${escapeHtml(g.planSlug)}">Quitar</button>
      </div>
    `).join('')
    : '<span class="admin-subtitle">Sin accesos a planes privados</span>';
  el.querySelectorAll('[data-revoke-grant]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/users/${userId}/plan-access/${encodeURIComponent(btn.dataset.revokeGrant)}`, { method: 'DELETE' });
      toast('Acceso revocado');
      renderUserPlanGrants(userId);
    });
  });
  const privatePlans = plansCache.filter((p) => p.visibility !== 'public' && p.active);
  select.innerHTML = '<option value="">Seleccionar plan…</option>' + privatePlans.map((p) =>
    `<option value="${escapeHtml(p.slug)}">${escapeHtml(p.name)} (${escapeHtml(p.slug)})</option>`).join('');
}

async function showUserEditor(userId) {
  const user = usersCache.find((u) => u.id === userId);
  if (!user) return;
  if (!rolesCache.length) {
    const rolesData = await api('/roles');
    if (rolesData) {
      rolesCache = rolesData.roles;
      permissionsCache = rolesData.permissions;
    }
  }
  const detail = await api(`/users/${userId}`);
  if (!detail) return;
  document.getElementById('edit-user-id').value = user.id;
  document.getElementById('edit-user-email').value = user.email;
  document.getElementById('edit-user-plan').value = user.plan;
  document.getElementById('edit-user-tunnel-override').value = user.tunnelLimitOverride ?? '';
  document.getElementById('edit-user-subdomain-override').value = user.reservedSubdomainLimitOverride ?? '';
  document.getElementById('edit-user-active').checked = user.active;
  document.getElementById('edit-user-verified').checked = user.emailVerified;
  document.getElementById('edit-user-admin').checked = user.isAdmin;
  document.getElementById('edit-user-comp-sub').checked = false;
  renderUserRoleCheckboxes(detail.roleSlugs || []);
  await renderUserPlanGrants(userId);
  document.getElementById('user-form-msg').hidden = true;
  document.getElementById('user-dialog').showModal();
}

function showPlanEditor(plan = null) {
  document.getElementById('plan-dialog-title').textContent = plan ? 'Editar plan' : 'Nuevo plan';
  document.getElementById('edit-plan-id').value = plan?.id || '';
  document.getElementById('edit-plan-slug').value = plan?.slug || '';
  document.getElementById('edit-plan-slug').disabled = Boolean(plan);
  document.getElementById('edit-plan-name').value = plan?.name || '';
  document.getElementById('edit-plan-description').value = plan?.description || '';
  document.getElementById('edit-plan-price-monthly').value = plan?.priceMonthly ?? 0;
  document.getElementById('edit-plan-price-yearly').value = plan?.priceYearly ?? '';
  document.getElementById('edit-plan-tunnel-limit').value = plan?.tunnelLimit ?? 5;
  document.getElementById('edit-plan-subdomain-limit').value = plan?.reservedSubdomainLimit ?? 5;
  document.getElementById('edit-plan-custom-subdomain').checked = plan?.customSubdomain ?? true;
  document.getElementById('edit-plan-active').checked = plan?.active ?? true;
  document.getElementById('edit-plan-type').value = plan?.planType || 'personal';
  document.getElementById('edit-plan-visibility').value =
    plan?.visibility === 'public' ? 'public' : 'private';
  document.getElementById('edit-plan-max-seats').value = plan?.maxSeats ?? 1;
  document.getElementById('edit-plan-currency').value = plan?.currency || 'USD';
  document.getElementById('edit-plan-feature-cname').checked = plan?.features?.customCname ?? false;
  document.getElementById('edit-plan-feature-cname-limit').value = plan?.features?.customCnameLimit ?? 0;
  document.getElementById('edit-plan-feature-api').checked = plan?.features?.apiAccess ?? false;
  document.getElementById('edit-plan-feature-support').checked = plan?.features?.prioritySupport ?? false;
  document.getElementById('plan-form-msg').hidden = true;
  document.getElementById('plan-dialog').showModal();
}

async function sendActivationEmail(userId) {
  if (!confirm('¿Reenviar el correo de activación?')) return;
  try {
    const data = await api(`/users/${userId}/send-activation-email`, { method: 'POST' });
    if (!data) return;
    toast(data.message || 'Correo enviado');
    loadLogs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function sendPasswordResetEmail(userId) {
  if (!confirm('¿Enviar correo de recuperación de contraseña?')) return;
  try {
    const data = await api(`/users/${userId}/send-password-reset`, { method: 'POST' });
    if (!data) return;
    toast(data.message || 'Correo enviado');
    loadLogs();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function suspendUser(userId) {
  if (!confirm('¿Suspender esta cuenta y cerrar todos sus túneles?')) return;
  const data = await api(`/users/${userId}/suspend`, { method: 'POST' });
  if (!data) return;
  toast('Usuario suspendido');
  loadUsers();
  if (currentRoute === 'overview') loadOverview();
  loadTunnels();
  loadAnonymous();
  loadLogs();
}

async function closeUserTunnels(userId) {
  if (!confirm('¿Cerrar todos los túneles activos de este usuario?')) return;
  const data = await api(`/users/${userId}/close-tunnels`, { method: 'POST' });
  if (!data) return;
  toast(`Cerrados ${data.closedTunnels} túnel(es)`);
  loadUsers();
  loadTunnels();
  loadLogs();
}

async function deleteUser(userId) {
  if (!confirm('¿Eliminar este usuario de forma permanente?')) return;
  const data = await api(`/users/${userId}`, { method: 'DELETE' });
  if (!data) return;
  toast('Usuario eliminado');
  loadUsers();
  loadSubdomains();
  loadLogs();
}

function exportUsersCsv() {
  if (!usersCache.length) return toast('No hay datos para exportar', 'error');
  const header = 'email,plan,active,verified,tunnels,subdomains,created_at\n';
  const rows = usersCache.map((u) => [
    u.email, u.plan, u.active, u.emailVerified,
    `${u.activeTunnelCount}/${u.tunnelLimit}`,
    `${u.reservedCount}/${u.reservedSubdomainLimit}`,
    u.createdAt,
  ].join(',')).join('\n');
  downloadCsv(`dtunnel-users-${Date.now()}.csv`, header + rows);
  toast('CSV exportado');
}

function exportLogsCsv() {
  if (!logsCache.length) return toast('No hay datos para exportar', 'error');
  const header = 'date,action,actor,target,ip,details\n';
  const rows = logsCache.map((l) => [
    l.createdAt, l.action, l.actorEmail || '',
    l.targetType ? `${l.targetType}:${l.targetId}` : '',
    l.ip || '', l.details ? JSON.stringify(l.details) : '',
  ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCsv(`dtunnel-audit-${Date.now()}.csv`, header + rows);
  toast('CSV exportado');
}

function exportTracesCsv() {
  if (!tracesCache.length) return toast('No hay datos para exportar', 'error');
  const header = 'date,method,path,status,duration_ms,subdomain,user,ip\n';
  const rows = tracesCache.map((t) => [
    t.createdAt, t.method, t.path, t.status ?? '', t.durationMs ?? '',
    t.subdomain, t.email || '', t.clientIp || '',
  ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCsv(`dtunnel-traces-${Date.now()}.csv`, header + rows);
  toast('CSV exportado');
}

// Event listeners
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  document.getElementById('ws-sidebar').classList.toggle('open');
});

document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('dtunnel_token');
  localStorage.removeItem('dtunnel_email');
  window.location.href = '/login.html';
});

document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  document.getElementById('users-search').value = q;
  usersPage = 0;
  navigate('users');
});

document.getElementById('refresh-users').addEventListener('click', loadUsers);
document.getElementById('refresh-tunnels').addEventListener('click', loadTunnels);
document.getElementById('refresh-anonymous').addEventListener('click', loadAnonymous);
document.getElementById('refresh-subdomains').addEventListener('click', loadSubdomains);
document.getElementById('refresh-logs').addEventListener('click', loadLogs);
document.getElementById('refresh-traces').addEventListener('click', loadTraces);
document.getElementById('refresh-subscriptions').addEventListener('click', loadSubscriptions);
document.getElementById('export-users-btn').addEventListener('click', exportUsersCsv);
document.getElementById('export-logs-btn').addEventListener('click', exportLogsCsv);
document.getElementById('export-traces-btn').addEventListener('click', exportTracesCsv);
document.getElementById('new-plan-btn').addEventListener('click', () => showPlanEditor());
document.getElementById('new-user-btn').addEventListener('click', () => {
  document.getElementById('create-user-form').reset();
  document.getElementById('create-user-active').checked = true;
  document.getElementById('create-user-msg').hidden = true;
  document.getElementById('create-user-dialog').showModal();
});

let usersSearchTimer;
document.getElementById('users-search').addEventListener('input', () => {
  clearTimeout(usersSearchTimer);
  usersSearchTimer = setTimeout(() => { usersPage = 0; loadUsers(); }, 300);
});
document.getElementById('users-plan-filter').addEventListener('change', () => { usersPage = 0; loadUsers(); });
document.getElementById('users-active-filter').addEventListener('change', () => { usersPage = 0; loadUsers(); });

let tunnelsSearchTimer;
document.getElementById('tunnels-search').addEventListener('input', () => {
  clearTimeout(tunnelsSearchTimer);
  tunnelsSearchTimer = setTimeout(loadTunnels, 200);
});
let subdomainsSearchTimer;
document.getElementById('subdomains-search').addEventListener('input', () => {
  clearTimeout(subdomainsSearchTimer);
  subdomainsSearchTimer = setTimeout(loadSubdomains, 200);
});

document.getElementById('logs-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { logsPage = 0; loadLogs(); }
});
document.getElementById('logs-action-filter').addEventListener('change', () => { logsPage = 0; loadLogs(); });

document.getElementById('traces-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { tracesPage = 0; loadTraces(); }
});
document.getElementById('traces-subdomain-filter').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { tracesPage = 0; loadTraces(); }
});
document.getElementById('traces-status-filter').addEventListener('change', () => { tracesPage = 0; loadTraces(); });
document.getElementById('traces-live-toggle').addEventListener('change', () => {
  if (document.getElementById('traces-live-toggle').checked) startTracesLive();
  else stopTracesLive();
});

document.getElementById('grant-plan-btn')?.addEventListener('click', async () => {
  const userId = document.getElementById('edit-user-id').value;
  const planSlug = document.getElementById('grant-plan-slug').value;
  if (!userId || !planSlug) return toast('Selecciona un plan', 'error');
  const data = await api(`/users/${userId}/plan-access`, {
    method: 'POST',
    body: JSON.stringify({ planSlug, note: 'Concedido desde admin' }),
  });
  if (!data) return;
  toast('Acceso concedido');
  renderUserPlanGrants(Number(userId));
});

document.getElementById('subscriptions-search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { subscriptionsPage = 0; loadSubscriptions(); }
});
document.getElementById('subscriptions-status-filter')?.addEventListener('change', () => {
  subscriptionsPage = 0;
  loadSubscriptions();
});

document.getElementById('users-table').addEventListener('click', (e) => {
  const editId = Number(e.target.dataset.editUser);
  if (editId) showUserEditor(editId);
  const suspendId = Number(e.target.dataset.suspendUser);
  if (suspendId) suspendUser(suspendId);
  const closeId = Number(e.target.dataset.closeUserTunnels);
  if (closeId) closeUserTunnels(closeId);
  const deleteId = Number(e.target.dataset.deleteUser);
  if (deleteId) deleteUser(deleteId);
  const activationId = Number(e.target.dataset.sendActivation);
  if (activationId) sendActivationEmail(activationId);
  const resetId = Number(e.target.dataset.sendPasswordReset);
  if (resetId) sendPasswordResetEmail(resetId);
  const impId = Number(e.target.dataset.impersonateUser);
  if (impId) impersonateUser(impId);
});

document.getElementById('plans-table').addEventListener('click', (e) => {
  const id = Number(e.target.dataset.editPlan);
  if (!id) return;
  showPlanEditor(plansCache.find((p) => p.id === id));
});

document.getElementById('tunnels-table').addEventListener('click', async (e) => {
  const id = Number(e.target.dataset.deleteTunnel);
  if (!id) return;
  if (!confirm('¿Cerrar este túnel?')) return;
  await api(`/tunnels/${id}`, { method: 'DELETE' });
  toast('Túnel cerrado');
  loadTunnels();
  loadAnonymous();
  loadLogs();
});

document.getElementById('anonymous-table').addEventListener('click', async (e) => {
  const ipEnc = e.target.dataset.closeAnonIp;
  if (ipEnc) {
    const ip = decodeURIComponent(ipEnc);
    if (!confirm(`¿Cerrar todos los túneles anónimos de ${ip}?`)) return;
    const data = await api('/tunnels/anonymous/close-by-ip', { method: 'POST', body: JSON.stringify({ ip }) });
    if (!data) return;
    toast(`Cerrados ${data.closed} túnel(es)`);
    loadAnonymous();
    loadTunnels();
    loadLogs();
    return;
  }
  const id = Number(e.target.dataset.deleteTunnel);
  if (!id) return;
  if (!confirm('¿Cerrar este túnel anónimo?')) return;
  await api(`/tunnels/${id}`, { method: 'DELETE' });
  loadAnonymous();
  loadTunnels();
  loadLogs();
});

document.getElementById('subdomains-table').addEventListener('click', async (e) => {
  const id = Number(e.target.dataset.releaseSubdomain);
  const name = e.target.dataset.subName;
  if (!id) return;
  if (!confirm(`¿Liberar el subdominio "${name}"?`)) return;
  await api(`/subdomains/${id}`, { method: 'DELETE' });
  toast('Subdominio liberado');
  loadSubdomains();
  loadLogs();
});

document.getElementById('user-cancel').addEventListener('click', () => document.getElementById('user-dialog').close());
document.getElementById('plan-cancel').addEventListener('click', () => document.getElementById('plan-dialog').close());
document.getElementById('create-user-cancel').addEventListener('click', () => document.getElementById('create-user-dialog').close());
document.getElementById('role-cancel').addEventListener('click', () => document.getElementById('role-dialog').close());
document.getElementById('role-view-close').addEventListener('click', () => document.getElementById('role-view-dialog').close());
document.getElementById('coupon-cancel').addEventListener('click', () => document.getElementById('coupon-dialog').close());

document.getElementById('role-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('role-form-msg');
  msg.hidden = true;
  const mode = document.getElementById('edit-role-mode').value;
  const slug = document.getElementById('edit-role-slug').value.trim().toLowerCase();
  const name = document.getElementById('edit-role-name').value.trim();
  const scope = document.getElementById('edit-role-scope').value;
  const permissions = getSelectedPermissions('role-permissions-grid');
  const existing = rolesCache.find((r) => r.slug === slug);
  try {
    if (mode === 'create') {
      await api('/roles', {
        method: 'POST',
        body: JSON.stringify({ slug, name, scope, permissions }),
      });
      toast('Rol creado');
    } else {
      await api(`/roles/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, permissions }),
      });
      toast('Rol actualizado');
    }
    document.getElementById('role-dialog').close();
    loadRoles();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
});

document.getElementById('coupon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('coupon-form-msg');
  msg.hidden = true;
  const id = document.getElementById('edit-coupon-id').value;
  const maxUsesRaw = document.getElementById('edit-coupon-max-uses').value;
  const validUntilRaw = document.getElementById('edit-coupon-valid-until').value;
  const payload = {
    code: document.getElementById('edit-coupon-code').value.trim(),
    description: document.getElementById('edit-coupon-description').value.trim(),
    discountType: document.getElementById('edit-coupon-type').value,
    discountValue: Number(document.getElementById('edit-coupon-value').value),
    maxUses: maxUsesRaw === '' ? null : Number(maxUsesRaw),
    validUntil: validUntilRaw ? new Date(validUntilRaw).toISOString() : null,
    active: document.getElementById('edit-coupon-active').checked,
  };
  try {
    if (id) {
      await api(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast('Cupón actualizado');
    } else {
      await api('/coupons', { method: 'POST', body: JSON.stringify(payload) });
      toast('Cupón creado');
    }
    document.getElementById('coupon-dialog').close();
    loadCoupons();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
});

document.addEventListener('click', (e) => {
  const couponId = Number(e.target.dataset.editCoupon);
  if (couponId) showCouponEditor(couponsCache.find((c) => c.id === couponId));
});

document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('user-form-msg');
  msg.hidden = true;
  try {
    const tunnelOverride = document.getElementById('edit-user-tunnel-override').value;
    const subdomainOverride = document.getElementById('edit-user-subdomain-override').value;
    const userId = document.getElementById('edit-user-id').value;
    const roleSlugs = [...document.querySelectorAll('#edit-user-roles input[name="user-role"]:checked')].map((i) => i.value);
    await api(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        plan: document.getElementById('edit-user-plan').value,
        active: document.getElementById('edit-user-active').checked,
        emailVerified: document.getElementById('edit-user-verified').checked,
        isAdmin: document.getElementById('edit-user-admin').checked,
        tunnelLimitOverride: tunnelOverride === '' ? null : Number(tunnelOverride),
        reservedSubdomainLimitOverride: subdomainOverride === '' ? null : Number(subdomainOverride),
        compSubscription: document.getElementById('edit-user-comp-sub').checked,
      }),
    });
    await api(`/users/${userId}/roles`, {
      method: 'PATCH',
      body: JSON.stringify({ roleSlugs }),
    });
    document.getElementById('user-dialog').close();
    toast('Usuario actualizado');
    loadUsers();
    loadLogs();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
});

document.getElementById('create-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('create-user-msg');
  msg.hidden = true;
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('create-user-email').value.trim(),
        password: document.getElementById('create-user-password').value,
        plan: document.getElementById('create-user-plan').value,
        active: document.getElementById('create-user-active').checked,
        emailVerified: document.getElementById('create-user-verified').checked,
        isAdmin: document.getElementById('create-user-admin').checked,
        sendActivation: document.getElementById('create-user-send-activation').checked,
      }),
    });
    document.getElementById('create-user-dialog').close();
    toast('Usuario creado');
    usersPage = 0;
    loadUsers();
    loadLogs();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
});

document.getElementById('plan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('plan-form-msg');
  msg.hidden = true;
  const payload = {
    slug: document.getElementById('edit-plan-slug').value.trim(),
    name: document.getElementById('edit-plan-name').value.trim(),
    description: document.getElementById('edit-plan-description').value.trim(),
    priceMonthly: Number(document.getElementById('edit-plan-price-monthly').value),
    priceYearly: document.getElementById('edit-plan-price-yearly').value === ''
      ? null
      : Number(document.getElementById('edit-plan-price-yearly').value),
    tunnelLimit: Number(document.getElementById('edit-plan-tunnel-limit').value),
    reservedSubdomainLimit: Number(document.getElementById('edit-plan-subdomain-limit').value),
    customSubdomain: document.getElementById('edit-plan-custom-subdomain').checked,
    active: document.getElementById('edit-plan-active').checked,
    planType: document.getElementById('edit-plan-type').value,
    visibility: document.getElementById('edit-plan-visibility').value,
    maxSeats: Number(document.getElementById('edit-plan-max-seats').value),
    currency: document.getElementById('edit-plan-currency').value,
    features: {
      customCname: document.getElementById('edit-plan-feature-cname').checked,
      customCnameLimit: Number(document.getElementById('edit-plan-feature-cname-limit').value),
      apiAccess: document.getElementById('edit-plan-feature-api').checked,
      prioritySupport: document.getElementById('edit-plan-feature-support').checked,
      customSubdomain: document.getElementById('edit-plan-custom-subdomain').checked,
    },
  };
  try {
    const id = document.getElementById('edit-plan-id').value;
    if (id) await api(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    else await api('/plans', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('plan-dialog').close();
    toast('Plan guardado');
    loadPlans();
  } catch (err) {
    msg.textContent = err.message;
    msg.hidden = false;
  }
});

document.getElementById('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('settings-msg');
  msg.hidden = true;
  try {
    await api('/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        anonTunnelLimit: Number(document.getElementById('anon-limit').value),
        heartbeatTimeoutMin: Number(document.getElementById('heartbeat-timeout').value),
        staleTunnelHours: Number(document.getElementById('stale-hours').value),
      }),
    });
    msg.textContent = 'Ajustes guardados';
    msg.className = 'form-success';
    msg.hidden = false;
    toast('Ajustes guardados');
    loadLogs();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-error';
    msg.hidden = false;
  }
});

document.getElementById('purge-stale-btn').addEventListener('click', async () => {
  if (!confirm('¿Purgar túneles obsoletos?')) return;
  const data = await api('/maintenance/purge-stale', { method: 'POST' });
  if (!data) return;
  document.getElementById('maintenance-msg').textContent = `Eliminados ${data.removed} túnel(es).`;
  toast(`Purgados ${data.removed} túneles`);
  loadTunnels();
  loadLogs();
});

document.getElementById('purge-logs-btn').addEventListener('click', async () => {
  if (!confirm('¿Eliminar logs de más de 30 días?')) return;
  const data = await api('/maintenance/purge-logs', { method: 'POST', body: JSON.stringify({ days: 30 }) });
  if (!data) return;
  document.getElementById('maintenance-msg').textContent = `Eliminados ${data.removed} registro(s).`;
  toast(`Purgados ${data.removed} logs`);
  loadLogs();
});

document.getElementById('purge-traces-btn').addEventListener('click', async () => {
  if (!confirm('¿Eliminar trazas HTTP de más de 14 días?')) return;
  const data = await api('/maintenance/purge-request-traces', { method: 'POST', body: JSON.stringify({ days: 14 }) });
  if (!data) return;
  document.getElementById('maintenance-msg').textContent = `Eliminadas ${data.removed} traza(s).`;
  toast(`Purgadas ${data.removed} trazas`);
  if (currentRoute === 'traces') loadTraces();
});

document.getElementById('twofa-enable-btn')?.addEventListener('click', async () => {
  const code = document.getElementById('twofa-enable-code').value.trim();
  if (!code) return toast('Introduce el código', 'error');
  try {
    const data = await apiAuth('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
    const backup = document.getElementById('twofa-backup-codes');
    backup.hidden = false;
    backup.innerHTML = `<strong>Guarda estos códigos de respaldo:</strong><br><code>${data.backupCodes.join('<br>')}</code>`;
    toast('2FA activado');
    loadSettings();
  } catch (err) {
    toast(err.message, 'error');
  }
});

window.addEventListener('popstate', () => {
  const route = location.hash.replace('#/', '') || 'overview';
  if (currentRoute === 'traces' && route !== 'traces') stopTracesLive();
  if (currentRoute === 'console' && route !== 'console') disconnectConsoleWs();
  currentRoute = route;
  setActiveNav(route);
  updateBreadcrumb(route);
  loadRoute(route);
});

document.getElementById('console-filter')?.addEventListener('change', (e) => {
  consoleFilter = e.target.value;
  applyConsoleFilter();
});
document.getElementById('console-pause')?.addEventListener('change', (e) => {
  consolePaused = e.target.checked;
});
document.getElementById('console-clear')?.addEventListener('click', clearConsoleFeed);

async function init() {
  buildNav();
  renderImpersonationBanner();
  if (isImpersonating()) {
    document.getElementById('admin-email').textContent = parseJwt(token)?.email || '';
    toast('Modo impersonación — acciones de admin limitadas', 'error');
    return;
  }
  const me = await api('/me');
  if (!me) return;
  document.getElementById('admin-email').textContent = me.email;
  const rolesData = await api('/roles');
  if (rolesData) {
    rolesCache = rolesData.roles;
    permissionsCache = rolesData.permissions;
  }
  connectMetricsWs();
  initSecurityPanel({ toast });
  initWorkspace({ toast });
  await loadPlans();
  const initial = location.hash.replace('#/', '') || 'overview';
  navigate(ROUTES[initial] ? initial : 'overview', { replace: true });
}

init();
