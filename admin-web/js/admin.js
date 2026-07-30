import { API_BASE, MAIN_SITE, TUNNEL_DOMAIN } from './config.js';

const token = localStorage.getItem('dtunnel_token');
if (!token) window.location.href = '/login.html';

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

let plansCache = [];

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}/admin${path}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }
  if (res.status === 403) {
    alert('No tienes permisos de administrador.');
    window.location.href = MAIN_SITE;
    return null;
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function badge(text, kind = 'default') {
  return `<span class="badge badge-${kind}">${text}</span>`;
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value.includes('T') ? value : `${value}Z`).toLocaleString('es');
}

function setTab(tab) {
  document.querySelectorAll('.admin-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.querySelectorAll('.admin-panel').forEach((el) => {
    el.classList.toggle('active', el.id === `panel-${tab}`);
  });
}

async function loadOverview() {
  const stats = await api('/stats');
  if (!stats) return;
  document.getElementById('stats-grid').innerHTML = `
    <article class="stat-card"><span class="stat-label">Usuarios</span><strong>${stats.users}</strong><small>${stats.activeUsers} activos</small></article>
    <article class="stat-card"><span class="stat-label">Planes activos</span><strong>${stats.plans}</strong></article>
    <article class="stat-card"><span class="stat-label">Túneles activos</span><strong>${stats.activeTunnels}</strong><small>${stats.anonTunnels} anónimos</small></article>
    <article class="stat-card"><span class="stat-label">Subdominios reservados</span><strong>${stats.reservedSubdomains}</strong></article>
    <article class="stat-card"><span class="stat-label">Límite anónimo</span><strong>${stats.anonTunnelLimit}</strong></article>
  `;
}

async function loadUsers() {
  const data = await api('/users');
  if (!data) return;
  const tbody = document.querySelector('#users-table tbody');
  tbody.innerHTML = data.users.map((user) => `
    <tr>
      <td>${user.email}</td>
      <td>${badge(user.plan)}</td>
      <td>${user.active ? badge('activo', 'ok') : badge('inactivo', 'warn')}</td>
      <td>${user.activeTunnelCount} / ${user.tunnelLimit}</td>
      <td>${user.reservedCount} / ${user.reservedSubdomainLimit}</td>
      <td>${user.isAdmin ? badge('sí', 'accent') : '—'}</td>
      <td class="admin-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-edit-user="${user.id}">Editar</button>
        ${user.activeTunnelCount > 0 ? `<button type="button" class="btn btn-ghost btn-sm" data-close-user-tunnels="${user.id}">Cerrar túneles</button>` : ''}
        ${user.active ? `<button type="button" class="btn btn-ghost btn-sm" data-suspend-user="${user.id}">Suspender</button>` : ''}
        <button type="button" class="btn btn-ghost btn-sm btn-danger" data-delete-user="${user.id}">Eliminar</button>
      </td>
    </tr>
  `).join('');
}

async function loadPlans() {
  const data = await api('/plans');
  if (!data) return;
  plansCache = data.plans;
  const tbody = document.querySelector('#plans-table tbody');
  tbody.innerHTML = data.plans.map((plan) => `
    <tr>
      <td><code>${plan.slug}</code></td>
      <td>${plan.name}</td>
      <td>$${Number(plan.priceMonthly).toFixed(2)}</td>
      <td>${plan.tunnelLimit}</td>
      <td>${plan.reservedSubdomainLimit}</td>
      <td>${plan.customSubdomain ? 'Sí' : 'No'}</td>
      <td>${plan.active ? badge('activo', 'ok') : badge('inactivo', 'warn')}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-edit-plan="${plan.id}">Editar</button></td>
    </tr>
  `).join('');

  const select = document.getElementById('edit-user-plan');
  select.innerHTML = data.plans.filter((p) => p.active).map((plan) => `
    <option value="${plan.slug}">${plan.name}</option>
  `).join('');
}

async function loadTunnels() {
  const data = await api('/tunnels');
  if (!data) return;
  const tbody = document.querySelector('#tunnels-table tbody');
  tbody.innerHTML = data.tunnels.length ? data.tunnels.map((tunnel) => `
    <tr>
      <td><a href="https://${tunnel.subdomain}.${TUNNEL_DOMAIN}" target="_blank" rel="noopener">${tunnel.subdomain}</a></td>
      <td>${tunnel.port}</td>
      <td>${tunnel.email || '<em>anónimo</em>'}</td>
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
  const limit = data.anonTunnelLimit ?? '—';
  document.getElementById('anonymous-meta').textContent =
    `${data.total} túnel(es) anónimo(s) en ${data.groups.length} IP(s) · límite por IP: ${limit}`;
  const tbody = document.querySelector('#anonymous-table tbody');
  if (!data.groups.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No hay túneles anónimos activos</td></tr>';
    return;
  }
  const rows = [];
  for (const group of data.groups) {
    const ipLabel = group.clientIp || '(sin IP)';
    const ipAttr = group.clientIp || '';
    rows.push(`
      <tr class="anon-ip-header">
        <td colspan="5"><strong>${ipLabel}</strong> · ${group.count} túnel(es)</td>
        <td class="admin-actions">
          ${group.clientIp ? `<button type="button" class="btn btn-ghost btn-sm" data-close-anon-ip="${encodeURIComponent(group.clientIp)}">Cerrar IP</button>` : ''}
        </td>
      </tr>
    `);
    for (const tunnel of group.tunnels) {
      rows.push(`
        <tr class="anon-tunnel-row">
          <td class="anon-ip-indent">${ipLabel}</td>
          <td><a href="https://${tunnel.subdomain}.${TUNNEL_DOMAIN}" target="_blank" rel="noopener"><code>${tunnel.subdomain}</code></a></td>
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

async function loadSettings() {
  const data = await api('/settings');
  if (!data) return;
  document.getElementById('anon-limit').value = data.anonTunnelLimit;
  document.getElementById('heartbeat-timeout').value = data.heartbeatTimeoutMin;
  document.getElementById('stale-hours').value = data.staleTunnelHours;
}

async function loadSubdomains() {
  const data = await api('/subdomains');
  if (!data) return;
  const tbody = document.querySelector('#subdomains-table tbody');
  tbody.innerHTML = data.subdomains.length ? data.subdomains.map((sub) => `
    <tr>
      <td><a href="https://${sub.name}.${TUNNEL_DOMAIN}" target="_blank" rel="noopener"><code>${sub.name}</code></a></td>
      <td>${sub.email}</td>
      <td>${sub.tunnelActive ? badge('activo', 'ok') : badge('inactivo', 'warn')}</td>
      <td>${fmtDate(sub.createdAt)}</td>
      <td><button type="button" class="btn btn-ghost btn-sm" data-release-subdomain="${sub.id}" data-sub-name="${sub.name}">Liberar</button></td>
    </tr>
  `).join('') : '<tr><td colspan="5" class="empty-cell">No hay subdominios reservados</td></tr>';
}

async function loadLogs() {
  const q = document.getElementById('logs-search').value.trim();
  const action = document.getElementById('logs-action-filter').value;
  const params = new URLSearchParams({ limit: '150' });
  if (q) params.set('q', q);
  if (action) params.set('action', action);
  const data = await api(`/logs?${params}`);
  if (!data) return;
  document.getElementById('logs-meta').textContent = `${data.total} evento(s) — mostrando ${data.logs.length}`;
  const tbody = document.querySelector('#logs-table tbody');
  tbody.innerHTML = data.logs.length ? data.logs.map((log) => `
    <tr>
      <td>${fmtDate(log.createdAt)}</td>
      <td><code>${log.action}</code></td>
      <td>${log.actorEmail || '<em>sistema</em>'}</td>
      <td>${log.targetType ? `${log.targetType}:${log.targetId || '—'}` : '—'}</td>
      <td>${log.ip || '—'}</td>
      <td class="log-details">${log.details ? JSON.stringify(log.details) : '—'}</td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="empty-cell">Sin registros</td></tr>';
}

function showUserEditor(userId) {
  api('/users').then((users) => {
    const user = users?.users.find((u) => u.id === userId);
    if (!user) return;
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-plan').value = user.plan;
    document.getElementById('edit-user-tunnel-override').value = user.tunnelLimitOverride ?? '';
    document.getElementById('edit-user-subdomain-override').value = user.reservedSubdomainLimitOverride ?? '';
    document.getElementById('edit-user-active').checked = user.active;
    document.getElementById('edit-user-admin').checked = user.isAdmin;
    document.getElementById('user-form-msg').hidden = true;
    document.getElementById('user-dialog').showModal();
  });
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
  document.getElementById('plan-form-msg').hidden = true;
  document.getElementById('plan-dialog').showModal();
}

document.getElementById('admin-tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (!tab) return;
  setTab(tab);
});

document.getElementById('refresh-users').addEventListener('click', loadUsers);
document.getElementById('refresh-tunnels').addEventListener('click', loadTunnels);
document.getElementById('refresh-anonymous').addEventListener('click', loadAnonymous);
document.getElementById('refresh-subdomains').addEventListener('click', loadSubdomains);
document.getElementById('refresh-logs').addEventListener('click', loadLogs);
document.getElementById('logs-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadLogs();
});
document.getElementById('logs-action-filter').addEventListener('change', loadLogs);
document.getElementById('new-plan-btn').addEventListener('click', () => showPlanEditor());

document.getElementById('users-table').addEventListener('click', (e) => {
  const editId = Number(e.target.dataset.editUser);
  if (editId) showUserEditor(editId);
  const suspendId = Number(e.target.dataset.suspendUser);
  if (suspendId) suspendUser(suspendId);
  const closeId = Number(e.target.dataset.closeUserTunnels);
  if (closeId) closeUserTunnels(closeId);
  const deleteId = Number(e.target.dataset.deleteUser);
  if (deleteId) deleteUser(deleteId);
});

async function suspendUser(userId) {
  if (!confirm('¿Suspender esta cuenta y cerrar todos sus túneles?')) return;
  const data = await api(`/users/${userId}/suspend`, { method: 'POST' });
  if (!data) return;
  loadUsers();
  loadOverview();
  loadTunnels();
  loadAnonymous();
  loadLogs();
}

async function closeUserTunnels(userId) {
  if (!confirm('¿Cerrar todos los túneles activos de este usuario?')) return;
  const data = await api(`/users/${userId}/close-tunnels`, { method: 'POST' });
  if (!data) return;
  alert(`Cerrados: ${data.closedTunnels} túnel(es)`);
  loadUsers();
  loadOverview();
  loadTunnels();
  loadLogs();
}

async function deleteUser(userId) {
  if (!confirm('¿Eliminar este usuario de forma permanente? Se liberarán sus subdominios y túneles.')) return;
  const data = await api(`/users/${userId}`, { method: 'DELETE' });
  if (!data) return;
  loadUsers();
  loadOverview();
  loadSubdomains();
  loadLogs();
}

document.getElementById('plans-table').addEventListener('click', (e) => {
  const id = Number(e.target.dataset.editPlan);
  if (!id) return;
  const plan = plansCache.find((p) => p.id === id);
  showPlanEditor(plan);
});

document.getElementById('tunnels-table').addEventListener('click', async (e) => {
  const id = Number(e.target.dataset.deleteTunnel);
  if (!id) return;
  if (!confirm('¿Cerrar este túnel en la base de datos?')) return;
  await api(`/tunnels/${id}`, { method: 'DELETE' });
  loadTunnels();
  loadAnonymous();
  loadOverview();
  loadLogs();
});

document.getElementById('anonymous-table').addEventListener('click', async (e) => {
  const ipEnc = e.target.dataset.closeAnonIp;
  if (ipEnc) {
    const ip = decodeURIComponent(ipEnc);
    if (!confirm(`¿Cerrar todos los túneles anónimos de la IP ${ip}?`)) return;
    const data = await api('/tunnels/anonymous/close-by-ip', {
      method: 'POST',
      body: JSON.stringify({ ip }),
    });
    if (!data) return;
    alert(`Cerrados: ${data.closed} túnel(es)`);
    loadAnonymous();
    loadTunnels();
    loadOverview();
    loadLogs();
    return;
  }
  const id = Number(e.target.dataset.deleteTunnel);
  if (!id) return;
  if (!confirm('¿Cerrar este túnel anónimo?')) return;
  await api(`/tunnels/${id}`, { method: 'DELETE' });
  loadAnonymous();
  loadTunnels();
  loadOverview();
  loadLogs();
});

document.getElementById('subdomains-table').addEventListener('click', async (e) => {
  const id = Number(e.target.dataset.releaseSubdomain);
  const name = e.target.dataset.subName;
  if (!id) return;
  if (!confirm(`¿Liberar el subdominio "${name}"?`)) return;
  await api(`/subdomains/${id}`, { method: 'DELETE' });
  loadSubdomains();
  loadOverview();
  loadLogs();
});

document.getElementById('user-cancel').addEventListener('click', () => document.getElementById('user-dialog').close());
document.getElementById('plan-cancel').addEventListener('click', () => document.getElementById('plan-dialog').close());

document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('user-form-msg');
  msg.hidden = true;
  try {
    const tunnelOverride = document.getElementById('edit-user-tunnel-override').value;
    const subdomainOverride = document.getElementById('edit-user-subdomain-override').value;
    await api(`/users/${document.getElementById('edit-user-id').value}`, {
      method: 'PATCH',
      body: JSON.stringify({
        plan: document.getElementById('edit-user-plan').value,
        active: document.getElementById('edit-user-active').checked,
        isAdmin: document.getElementById('edit-user-admin').checked,
        tunnelLimitOverride: tunnelOverride === '' ? null : Number(tunnelOverride),
        reservedSubdomainLimitOverride: subdomainOverride === '' ? null : Number(subdomainOverride),
      }),
    });
    document.getElementById('user-dialog').close();
    loadUsers();
    loadOverview();
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
  };
  try {
    const id = document.getElementById('edit-plan-id').value;
    if (id) {
      await api(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    } else {
      await api('/plans', { method: 'POST', body: JSON.stringify(payload) });
    }
    document.getElementById('plan-dialog').close();
    loadPlans();
    loadOverview();
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
    loadOverview();
    loadLogs();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-error';
    msg.hidden = false;
  }
});

document.getElementById('purge-stale-btn').addEventListener('click', async () => {
  if (!confirm('¿Purgar túneles obsoletos según los umbrales configurados?')) return;
  const msg = document.getElementById('maintenance-msg');
  const data = await api('/maintenance/purge-stale', { method: 'POST' });
  if (!data) return;
  msg.textContent = `Eliminados ${data.removed} túnel(es) obsoletos.`;
  loadTunnels();
  loadOverview();
  loadLogs();
});

document.getElementById('purge-logs-btn').addEventListener('click', async () => {
  if (!confirm('¿Eliminar logs de más de 30 días?')) return;
  const msg = document.getElementById('maintenance-msg');
  const data = await api('/maintenance/purge-logs', { method: 'POST', body: JSON.stringify({ days: 30 }) });
  if (!data) return;
  msg.textContent = `Eliminados ${data.removed} registro(s).`;
  loadLogs();
});

document.getElementById('logout').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem('dtunnel_token');
  localStorage.removeItem('dtunnel_email');
  window.location.href = '/login.html';
});

async function init() {
  const me = await api('/me');
  if (!me) return;
  document.getElementById('admin-email').textContent = me.email;
  await Promise.all([loadOverview(), loadUsers(), loadPlans(), loadTunnels(), loadAnonymous(), loadSubdomains(), loadLogs(), loadSettings()]);
}

init();
