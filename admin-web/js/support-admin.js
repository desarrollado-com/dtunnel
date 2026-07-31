import { API_BASE } from './config.js';

const token = localStorage.getItem('dtunnel_token');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let selectedTicketId = null;

async function supApi(path, options = {}) {
  const res = await fetch(`${API_BASE}/admin/support${path}`, {
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
  return new Date(v.includes('T') ? v : `${v}Z`).toLocaleString('es');
}

function statusBadge(status) {
  const map = {
    open: 'badge-warn',
    pending: 'badge',
    resolved: 'badge-ok',
    closed: 'text-muted',
  };
  return `<span class="badge ${map[status] || ''}">${esc(status)}</span>`;
}

function slaBadge(ticket) {
  if (!ticket.dueFirstResponseAt || ticket.firstResponseAt) return '';
  const overdue = new Date(ticket.dueFirstResponseAt) < new Date();
  return overdue
    ? '<span class="badge badge-error">ANS vencido</span>'
    : `<span class="text-muted" style="font-size:0.8rem">ANS: ${fmtDate(ticket.dueFirstResponseAt)}</span>`;
}

async function renderTicketDetail(ticketId, toast) {
  const panel = document.getElementById('support-detail');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const ticket = await supApi(`/tickets/${ticketId}`);
    selectedTicketId = ticketId;
    panel.innerHTML = `
      <div class="ws-card">
        <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1rem">
          <div>
            <h3 style="margin:0">#${ticket.id} — ${esc(ticket.subject)}</h3>
            <p class="admin-subtitle">${esc(ticket.userEmail)} · ${statusBadge(ticket.status)} ${slaBadge(ticket)}</p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            <select id="support-status-select" class="admin-select">
              ${['open', 'pending', 'resolved', 'closed'].map((s) => `<option value="${s}" ${ticket.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <button type="button" class="btn btn-ghost btn-sm" id="support-apply-status">Actualizar estado</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.75rem;margin-bottom:1rem;max-height:360px;overflow-y:auto">
          ${(ticket.messages || []).map((m) => `
            <div class="ws-card" style="padding:0.75rem;${m.isStaff ? 'border-color:var(--md-sys-color-primary)' : ''}">
              <div style="font-size:0.8rem;color:var(--md-sys-color-on-surface-variant);margin-bottom:0.35rem">
                ${m.isStaff ? 'Staff' : 'Usuario'} · ${esc(m.authorEmail || '—')} · ${fmtDate(m.createdAt)}
              </div>
              <div style="white-space:pre-wrap;font-size:0.9rem">${esc(m.body)}</div>
            </div>
          `).join('')}
        </div>
        <form id="support-reply-form" class="auth-form">
          <label class="form-group">
            <span>Responder</span>
            <textarea id="support-reply-body" rows="3" class="admin-search" style="width:100%;resize:vertical" required></textarea>
          </label>
          <button type="submit" class="btn btn-primary btn-sm">Enviar respuesta</button>
        </form>
      </div>
    `;
    panel.querySelector('#support-apply-status')?.addEventListener('click', async () => {
      const status = panel.querySelector('#support-status-select').value;
      await supApi(`/tickets/${ticketId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      renderTicketDetail(ticketId, toast);
      loadSupport({ toast });
    });
    panel.querySelector('#support-reply-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = panel.querySelector('#support-reply-body').value.trim();
      await supApi(`/tickets/${ticketId}/messages`, { method: 'POST', body: JSON.stringify({ body }) });
      renderTicketDetail(ticketId, toast);
      loadSupport({ toast });
    });
  } catch (err) {
    panel.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}

export async function loadSupport({ toast } = {}) {
  const panel = document.getElementById('panel-support');
  if (!panel) return;
  panel.innerHTML = '<p class="admin-subtitle">Cargando…</p>';
  try {
    const [stats, sla, ticketsData] = await Promise.all([
      supApi('/stats'),
      supApi('/sla'),
      supApi('/tickets?limit=50'),
    ]);
    panel.innerHTML = `
      <div class="ws-page-header">
        <div>
          <h1>Soporte y ANS</h1>
          <p>Tickets de usuarios y acuerdos de nivel de servicio por plan.</p>
        </div>
        <a href="https://dtunnel.desarrollado.com/ans.html" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Ver ANS público</a>
      </div>
      <div class="ws-stat-row" style="margin-bottom:1.5rem">
        <article class="ws-stat"><div class="ws-stat-label">Abiertos</div><div class="ws-stat-value">${stats.open}</div></article>
        <article class="ws-stat"><div class="ws-stat-label">ANS vencidos</div><div class="ws-stat-value">${stats.slaBreached}</div></article>
        <article class="ws-stat"><div class="ws-stat-label">Hoy</div><div class="ws-stat-value">${stats.createdToday}</div></article>
      </div>
      <div class="ws-grid-2">
        <div class="ws-card">
          <h3>Políticas ANS</h3>
          <div class="table-wrap">
            <table class="admin-table">
              <thead><tr><th>Plan</th><th>1ª respuesta</th><th>Resolución</th></tr></thead>
              <tbody>
                ${sla.policies.map((p) => `
                  <tr>
                    <td>${esc(p.planSlug || 'default')}</td>
                    <td>${p.firstResponseHours}h</td>
                    <td>${p.resolutionHours ? `${p.resolutionHours}h` : '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="ws-card">
          <h3>Tickets</h3>
          <div class="table-wrap" style="max-height:320px;overflow-y:auto">
            <table class="admin-table">
              <tbody>
                ${ticketsData.tickets.length ? ticketsData.tickets.map((t) => `
                  <tr data-ticket-id="${t.id}" style="cursor:pointer">
                    <td>${t.id}</td>
                    <td>${esc(t.subject)}</td>
                    <td>${esc(t.userEmail)}</td>
                    <td>${statusBadge(t.status)}</td>
                  </tr>
                `).join('') : '<tr><td colspan="4" class="empty-cell">Sin tickets</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div id="support-detail" style="margin-top:1.5rem"></div>
    `;
    panel.querySelectorAll('[data-ticket-id]').forEach((row) => {
      row.addEventListener('click', () => renderTicketDetail(Number(row.dataset.ticketId), toast));
    });
    if (selectedTicketId) renderTicketDetail(selectedTicketId, toast);
  } catch (err) {
    panel.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
  }
}
