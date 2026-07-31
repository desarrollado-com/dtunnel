const token = localStorage.getItem('dtunnel_token');
if (!token) window.location.href = '/login.html';

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const ROUTES = {
  overview: { title: 'Panel', section: 'General', icon: 'dashboard' },
  subdomains: { title: 'Subdominios', section: 'Cuenta', icon: 'dns' },
  tunnels: { title: 'Túneles', section: 'Cuenta', icon: 'hub' },
  traces: { title: 'Tráfico', section: 'Cuenta', icon: 'receipt_long' },
  billing: { title: 'Planes', section: 'Cuenta', icon: 'payments' },
  security: { title: 'Seguridad', section: 'Cuenta', icon: 'lock' },
  cli: { title: 'CLI', section: 'Ayuda', icon: 'terminal' },
};

let currentRoute = 'overview';
let meCache = null;
let traceRows = [];
let traceSocket = null;
const MAX_TRACE_ROWS = 100;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value.includes('T') ? value : `${value}Z`).toLocaleString('es');
}

function toast(message, kind = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `ws-toast ws-toast-${kind}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && data.code === 'EMAIL_NOT_VERIFIED') {
    sessionStorage.setItem('dtunnel_pending_email', data.email || localStorage.getItem('dtunnel_email') || '');
    window.location.href = '/verify-pending.html';
    return null;
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function buildNav() {
  const nav = document.getElementById('ws-nav');
  if (!nav) return;
  const sections = [...new Set(Object.values(ROUTES).map((r) => r.section))];
  nav.innerHTML = sections.map((section) => {
    const links = Object.entries(ROUTES)
      .filter(([, meta]) => meta.section === section)
      .map(([id, meta]) => `
        <a href="#/${id}" class="ws-nav-link" data-route="${id}">
          <span class="material-symbols-outlined">${meta.icon}</span>
          ${meta.title}
        </a>
      `).join('');
    return `<div class="ws-nav-section"><div class="ws-nav-label">${section}</div>${links}</div>`;
  }).join('');
  nav.querySelectorAll('.ws-nav-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigate(link.dataset.route);
    });
  });
}

function setActiveNav(route) {
  document.querySelectorAll('.ws-nav-link').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route);
  });
  document.querySelectorAll('.ws-panel').forEach((el) => {
    el.classList.toggle('active', el.dataset.route === route);
  });
}

function updateBreadcrumb(route) {
  const meta = ROUTES[route];
  const bc = document.getElementById('ws-breadcrumb');
  if (!bc || !meta) return;
  bc.innerHTML = `
    <span>dtunnel</span>
    <span class="material-symbols-outlined">chevron_right</span>
    <span>${meta.section}</span>
    <span class="material-symbols-outlined">chevron_right</span>
    <strong>${meta.title}</strong>
  `;
}

function navigate(route, { replace = false } = {}) {
  if (!ROUTES[route]) route = 'overview';
  if (currentRoute === 'traces' && route !== 'traces') disconnectTraces();
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
    subdomains: loadSubdomains,
    tunnels: loadTunnels,
    traces: loadTraces,
    billing: loadBilling,
    security: loadSecurity,
    cli: loadCli,
  };
  loaders[route]?.();
}

async function ensureMe() {
  if (meCache) return meCache;
  meCache = await api('/me');
  if (!meCache) return null;
  document.getElementById('user-email').textContent = meCache.email;
  const adminLink = document.getElementById('admin-external-link');
  if (adminLink) adminLink.hidden = !meCache.isAdmin;
  return meCache;
}

function statusClass(code) {
  if (!code) return 'text-muted';
  if (code >= 400) return 'form-error';
  if (code >= 300) return 'text-muted';
  return 'form-success';
}

async function loadOverview() {
  const panel = document.getElementById('panel-overview');
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const me = await ensureMe();
    if (!me) return;
    const [tunnelsData, traceStats] = await Promise.all([
      api('/tunnels').catch(() => ({ tunnels: [] })),
      api('/request-logs/stats').catch(() => ({ lastHour: 0, last24h: 0, total: 0 })),
    ]);
    const tunnels = tunnelsData?.tunnels || [];
    panel.innerHTML = `
      <div class="ws-page-header">
        <div>
          <h1>Panel de control</h1>
          <p>Bienvenido, ${escapeHtml(me.email)}</p>
        </div>
        <div class="ws-quick-actions">
          <span class="ws-live-dot" id="overview-live-dot">En vivo</span>
          <button type="button" class="btn btn-outlined btn-sm" data-goto="tunnels">Túneles</button>
          <button type="button" class="btn btn-outlined btn-sm" data-goto="traces">Tráfico</button>
        </div>
      </div>
      <div class="ws-stat-row">
        <article class="ws-stat">
          <div class="ws-stat-label">Plan</div>
          <div class="ws-stat-value" style="font-size:1.35rem">${escapeHtml(me.planName || me.plan)}</div>
          <div class="ws-stat-meta">${me.limits?.tunnelLimit ?? '—'} túnel(es) simultáneos</div>
        </article>
        <article class="ws-stat">
          <div class="ws-stat-label">Túneles activos</div>
          <div class="ws-stat-value">${tunnels.length}</div>
          <div class="ws-stat-meta">conexiones abiertas ahora</div>
        </article>
        <article class="ws-stat">
          <div class="ws-stat-label">Subdominios</div>
          <div class="ws-stat-value">${me.subdomains?.length ?? 0}</div>
          <div class="ws-stat-meta">nombres reservados</div>
        </article>
        <article class="ws-stat">
          <div class="ws-stat-label">Tráfico (24 h)</div>
          <div class="ws-stat-value">${traceStats?.last24h ?? 0}</div>
          <div class="ws-stat-meta">${traceStats?.lastHour ?? 0} última hora</div>
        </article>
      </div>
      <div class="ws-grid-2">
        <div class="ws-card">
          <h3>Túneles activos</h3>
          ${tunnels.length ? `<ul class="ws-recent-list">${tunnels.map((t) => `
            <li>
              <span><code>${escapeHtml(t.subdomain)}</code> → puerto ${t.port}</span>
              <a href="${t.httpsUrl}" target="_blank" rel="noopener">Abrir</a>
            </li>
          `).join('')}</ul>` : '<p class="text-muted">Ningún túnel activo. Usa <code>dtunnel --port 3000</code>.</p>'}
          <button type="button" class="btn btn-ghost btn-sm" data-goto="tunnels" style="margin-top:0.75rem">Ver todos</button>
        </div>
        <div class="ws-card">
          <h3>Primeros pasos</h3>
          <ol style="margin:0;padding-left:1.25rem;font-size:0.9rem;line-height:1.6">
            <li>Reserva un subdominio en <a href="#/subdomains">Subdominios</a></li>
            <li>Instala el CLI: <code>npm i -g @desarrollado/dtunnel</code></li>
            <li>Abre un túnel: <code>dtunnel --port 3000 -s mi-api</code></li>
            <li>Revisa el tráfico en <a href="#/traces">Tráfico</a></li>
          </ol>
          <button type="button" class="btn btn-ghost btn-sm" data-goto="cli" style="margin-top:0.75rem">Guía CLI</button>
        </div>
      </div>
    `;
    panel.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => navigate(btn.dataset.goto));
    });
  } catch (err) {
    panel.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

async function loadSubdomains() {
  const panel = document.getElementById('panel-subdomains');
  const me = await ensureMe();
  if (!me) return;
  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Subdominios</h1>
        <p>Reserva nombres para tus URLs públicas. La reserva no abre el túnel — usa el CLI después.</p>
      </div>
    </div>
    <div class="ws-card" style="max-width:480px;margin-bottom:1.5rem">
      <h3>Reservar nombre</h3>
      <form id="reserve-form" class="auth-form">
        <label class="form-group">
          <span>Nombre (ej. mi-api)</span>
          <input type="text" id="reserve-name" pattern="[a-z0-9-]{3,32}" required placeholder="mi-api" class="admin-search" style="width:100%">
        </label>
        <p id="reserve-msg" class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary">Reservar</button>
      </form>
    </div>
    <div class="ws-card">
      <h3>Mis nombres (${me.subdomains?.length ?? 0} / ${me.limits?.reservedSubdomainLimit ?? '—'})</h3>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>URL</th><th>Estado</th><th></th></tr></thead>
          <tbody id="subdomains-tbody"></tbody>
        </table>
      </div>
    </div>
  `;
  const tbody = panel.querySelector('#subdomains-tbody');
  const subs = me.subdomains || [];
  tbody.innerHTML = subs.length ? subs.map((s) => `
    <tr>
      <td><a href="https://${escapeHtml(s)}.dtunnel.desarrollado.com" target="_blank" rel="noopener"><code>${escapeHtml(s)}</code>.dtunnel.desarrollado.com</a></td>
      <td class="text-muted">Requiere túnel activo</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-release="${escapeHtml(s)}">Liberar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="3" class="text-muted">Ningún nombre reservado.</td></tr>';
  panel.querySelector('#reserve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = panel.querySelector('#reserve-msg');
    msg.hidden = true;
    try {
      await api('/subdomains/reserve', {
        method: 'POST',
        body: JSON.stringify({ name: panel.querySelector('#reserve-name').value }),
      });
      meCache = null;
      toast('Subdominio reservado');
      loadSubdomains();
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
  tbody.querySelectorAll('[data-release]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Liberar "${btn.dataset.release}"?`)) return;
      try {
        await api(`/subdomains/${encodeURIComponent(btn.dataset.release)}`, { method: 'DELETE' });
        meCache = null;
        toast('Subdominio liberado');
        loadSubdomains();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

async function loadTunnels() {
  const panel = document.getElementById('panel-tunnels');
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const data = await api('/tunnels');
    const tunnels = data?.tunnels || [];
    panel.innerHTML = `
      <div class="ws-page-header">
        <div>
          <h1>Túneles activos</h1>
          <p>Conexiones abiertas desde el CLI. Ciérralas con <code>dtunnel down</code> o desde aquí.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="refresh-tunnels">Actualizar</button>
      </div>
      <div class="table-wrap">
        <table class="admin-table">
          <thead><tr><th>Subdominio</th><th>Puerto</th><th>URL</th><th>Desde</th><th></th></tr></thead>
          <tbody id="tunnels-tbody"></tbody>
        </table>
      </div>
    `;
    const tbody = panel.querySelector('#tunnels-tbody');
    tbody.innerHTML = tunnels.length ? tunnels.map((t) => `
      <tr>
        <td><code>${escapeHtml(t.subdomain)}</code></td>
        <td>${t.port}</td>
        <td><a href="${t.httpsUrl}" target="_blank" rel="noopener">${escapeHtml(t.subdomain)}.dtunnel.desarrollado.com</a></td>
        <td>${fmtDate(t.createdAt)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-close="${escapeHtml(t.subdomain)}">Cerrar</button></td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="text-muted">Ningún túnel activo.</td></tr>';
    tbody.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeTunnel(btn.dataset.close));
    });
    panel.querySelector('#refresh-tunnels')?.addEventListener('click', loadTunnels);
  } catch (err) {
    panel.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

async function closeTunnel(subdomain) {
  if (!confirm(`¿Cerrar el túnel "${subdomain}"?`)) return;
  try {
    await api(`/tunnels/${encodeURIComponent(subdomain)}`, { method: 'DELETE' });
    toast('Túnel cerrado');
    if (currentRoute === 'tunnels') loadTunnels();
    if (currentRoute === 'overview') loadOverview();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderTraceRow(t) {
  return `
    <tr>
      <td>${fmtDate(t.createdAt)}</td>
      <td><code>${escapeHtml(t.method)}</code></td>
      <td class="log-details" title="${escapeHtml(t.path)}"><code>${escapeHtml(t.path)}</code></td>
      <td class="${statusClass(t.status)}">${t.status ?? '—'}</td>
      <td>${t.durationMs != null ? `${t.durationMs} ms` : '—'}</td>
      <td><code>${escapeHtml(t.subdomain)}</code></td>
    </tr>
  `;
}

function paintTraces() {
  const tbody = document.getElementById('traces-tbody');
  if (!tbody) return;
  tbody.innerHTML = traceRows.length
    ? traceRows.map(renderTraceRow).join('')
    : '<tr><td colspan="6" class="text-muted">Sin solicitudes recientes.</td></tr>';
}

function disconnectTraces() {
  if (traceSocket) {
    traceSocket.onclose = null;
    traceSocket.close();
    traceSocket = null;
  }
}

function connectTraces() {
  disconnectTraces();
  const badge = document.getElementById('trace-live-badge');
  const filter = document.getElementById('trace-subdomain-filter')?.value || '';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = `${proto}//${location.host}/api/request-logs/ws?token=${encodeURIComponent(token)}`;
  if (filter) url += `&subdomain=${encodeURIComponent(filter)}`;
  if (badge) {
    badge.textContent = 'Conectando…';
    badge.className = 'text-muted';
  }
  const ws = new WebSocket(url);
  traceSocket = ws;
  ws.onopen = () => {
    if (badge) {
      badge.textContent = '● En vivo';
      badge.className = 'ws-live-dot';
      badge.style.fontSize = '0.85rem';
    }
  };
  ws.onclose = () => {
    if (traceSocket !== ws || currentRoute !== 'traces') return;
    if (badge) badge.textContent = 'Reconectando…';
    setTimeout(connectTraces, 4000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'history' && Array.isArray(msg.traces)) {
      traceRows = msg.traces.slice(0, MAX_TRACE_ROWS);
      paintTraces();
    } else if (msg.type === 'trace' && msg.trace) {
      const f = document.getElementById('trace-subdomain-filter')?.value;
      if (f && msg.trace.subdomain !== f) return;
      traceRows.unshift(msg.trace);
      if (traceRows.length > MAX_TRACE_ROWS) traceRows.length = MAX_TRACE_ROWS;
      paintTraces();
    }
  };
}

async function loadTraces() {
  const panel = document.getElementById('panel-traces');
  const me = await ensureMe();
  if (!me) return;
  const names = [...(me.subdomains || [])].sort();
  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Tráfico en tiempo real</h1>
        <p>Solicitudes HTTP que pasan por tus túneles.</p>
      </div>
      <span class="ws-live-dot" id="trace-live-badge">Conectando…</span>
    </div>
    <div class="ws-table-toolbar">
      <div class="ws-table-filters">
        <select id="trace-subdomain-filter" class="admin-select">
          <option value="">Todos los subdominios</option>
          ${names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
        </select>
      </div>
      <span id="trace-stats" class="text-muted" style="font-size:0.85rem"></span>
    </div>
    <div class="table-wrap">
      <table class="admin-table">
        <thead><tr><th>Hora</th><th>Método</th><th>Ruta</th><th>Estado</th><th>Duración</th><th>Subdominio</th></tr></thead>
        <tbody id="traces-tbody"><tr><td colspan="6" class="text-muted">Cargando…</td></tr></tbody>
      </table>
    </div>
  `;
  panel.querySelector('#trace-subdomain-filter').addEventListener('change', () => {
    traceRows = [];
    paintTraces();
    connectTraces();
  });
  try {
    const stats = await api('/request-logs/stats');
    panel.querySelector('#trace-stats').textContent =
      `${stats.lastHour} última hora · ${stats.last24h} últimas 24 h · ${stats.total} total`;
  } catch { /* ignore */ }
  connectTraces();
}

function fmtMoney(cents, currency) {
  if (cents == null) return '—';
  return `${currency || 'USD'} ${(cents / 100).toFixed(2)}`;
}

function planBadge(plan) {
  return plan.visibility === 'public'
    ? '<span class="badge badge-ok">Público</span>'
    : '<span class="badge">Privado</span>';
}

async function subscribePlan(plan) {
  if (plan.slug === 'free' || !plan.priceMonthly) {
    if (!confirm(`¿Cambiar al plan ${plan.name}?`)) return;
  }
  const data = await api('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ planSlug: plan.slug, billingCycle: 'monthly' }),
  });
  if (data.checkout?.ready && data.checkout?.widgetUrl) {
    window.location.href = data.checkout.widgetUrl;
    return;
  }
  toast(plan.slug === 'free' ? 'Plan actualizado' : (data.checkout?.reason || 'Solicitud registrada'));
  meCache = null;
  loadBilling();
}

async function loadBilling() {
  const panel = document.getElementById('panel-billing');
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const me = await ensureMe();
    const [plansData, subData] = await Promise.all([
      api('/billing/plans'),
      api('/billing/subscription'),
    ]);
    const plans = plansData.plans || [];
    panel.innerHTML = `
      <div class="ws-page-header">
        <div>
          <h1>Planes y suscripción</h1>
          <p>Plan actual: <strong>${escapeHtml(me.planName || me.plan)}</strong></p>
        </div>
      </div>
      ${subData.active ? `
        <div class="ws-card" style="margin-bottom:1.5rem;max-width:720px">
          <h3>Suscripción activa</h3>
          <p>${escapeHtml(subData.active.planSlug)} · ${escapeHtml(subData.active.status)} · ${escapeHtml(subData.active.billingCycle)}${subData.active.currentPeriodEnd ? ` · hasta ${fmtDate(subData.active.currentPeriodEnd)}` : ''}</p>
        </div>
      ` : ''}
      <div class="ws-stat-row" style="margin-bottom:1.5rem" id="plans-grid"></div>
      <div class="ws-card">
        <h3>Historial</h3>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Fecha</th><th>Plan</th><th>Estado</th><th>Ciclo</th><th>Monto</th></tr></thead>
            <tbody id="billing-history"></tbody>
          </table>
        </div>
      </div>
    `;
    const grid = panel.querySelector('#plans-grid');
    grid.innerHTML = plans.length ? plans.map((plan) => {
      const isCurrent = plan.slug === me.plan;
      const price = plan.priceMonthly > 0 ? `$${Number(plan.priceMonthly).toLocaleString('es')}/mes` : 'Gratis';
      return `
        <article class="ws-stat" style="text-align:left">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem">
            <div class="ws-stat-label">${escapeHtml(plan.name)}</div>
            ${planBadge(plan)}
          </div>
          <div class="ws-stat-value" style="font-size:1.25rem">${price}</div>
          <div class="ws-stat-meta">${plan.tunnelLimit} túnel(es) · ${plan.reservedSubdomainLimit} subdominio(s)</div>
          ${isCurrent ? '<span class="badge badge-ok">Actual</span>' : `<button type="button" class="btn btn-primary btn-sm" data-plan="${escapeHtml(plan.slug)}">Elegir</button>`}
        </article>
      `;
    }).join('') : '<p class="text-muted">No hay planes disponibles.</p>';
    grid.querySelectorAll('[data-plan]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = plans.find((x) => x.slug === btn.dataset.plan);
        if (p) subscribePlan(p);
      });
    });
    const history = subData.history || me.subscriptionHistory || [];
    panel.querySelector('#billing-history').innerHTML = history.length ? history.map((s) => `
      <tr>
        <td>${fmtDate(s.createdAt)}</td>
        <td><code>${escapeHtml(s.planSlug)}</code></td>
        <td>${escapeHtml(s.status)}</td>
        <td>${escapeHtml(s.billingCycle)}</td>
        <td>${fmtMoney(s.amountCents, s.currency)}</td>
      </tr>
    `).join('') : '<tr><td colspan="5" class="text-muted">Sin historial</td></tr>';
  } catch (err) {
    panel.innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
  }
}

function loadSecurity() {
  const panel = document.getElementById('panel-security');
  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>Seguridad</h1>
        <p>Cambia tu contraseña y protege el acceso a tu cuenta.</p>
      </div>
    </div>
    <div class="ws-card" style="max-width:420px">
      <form id="password-form" class="auth-form">
        <label class="form-group">
          <span>Contraseña actual</span>
          <input type="password" id="current-password" required class="admin-search" style="width:100%">
        </label>
        <label class="form-group">
          <span>Nueva contraseña (mín. 8)</span>
          <input type="password" id="new-password" required minlength="8" class="admin-search" style="width:100%">
        </label>
        <p id="password-msg" class="form-error" hidden></p>
        <p id="password-ok" class="form-success" hidden></p>
        <button type="submit" class="btn btn-primary">Cambiar contraseña</button>
      </form>
    </div>
  `;
  panel.querySelector('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = panel.querySelector('#password-msg');
    const ok = panel.querySelector('#password-ok');
    msg.hidden = true;
    ok.hidden = true;
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: panel.querySelector('#current-password').value,
          password: panel.querySelector('#new-password').value,
        }),
      });
      ok.textContent = 'Contraseña actualizada.';
      ok.hidden = false;
      panel.querySelector('#password-form').reset();
      toast('Contraseña actualizada');
    } catch (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    }
  });
}

function loadCli() {
  const panel = document.getElementById('panel-cli');
  panel.innerHTML = `
    <div class="ws-page-header">
      <div>
        <h1>CLI dtunnel</h1>
        <p>Comandos para exponer tu localhost como URL pública HTTPS.</p>
      </div>
    </div>
    <div class="ws-card" style="margin-bottom:1rem">
      <h3>Instalación</h3>
      <pre><code>npm install -g @desarrollado/dtunnel
dtunnel login</code></pre>
    </div>
    <div class="ws-card" style="margin-bottom:1rem">
      <h3>Flujo habitual</h3>
      <pre><code>dtunnel reserve mi-api
dtunnel --port 3000 --subdomain mi-api
# trabaja con tu app…
dtunnel down</code></pre>
    </div>
    <div class="ws-card">
      <h3>Útiles</h3>
      <pre><code>dtunnel status
dtunnel logs --follow
dtunnel --list up</code></pre>
      <p style="margin-top:1rem"><a href="/docs.html" target="_blank" rel="noopener">Documentación completa →</a></p>
    </div>
  `;
}

async function init() {
  buildNav();
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.getElementById('ws-sidebar')?.classList.toggle('open');
  });
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('dtunnel_token');
    localStorage.removeItem('dtunnel_email');
    window.location.href = '/';
  });
  try {
    await ensureMe();
  } catch {
    window.location.href = '/login.html';
    return;
  }
  const initial = location.hash.replace('#/', '') || 'overview';
  navigate(ROUTES[initial] ? initial : 'overview', { replace: true });
}

window.addEventListener('popstate', () => {
  const route = location.hash.replace('#/', '') || 'overview';
  if (currentRoute === 'traces' && route !== 'traces') disconnectTraces();
  currentRoute = route;
  setActiveNav(route);
  updateBreadcrumb(route);
  loadRoute(route);
});

init();
