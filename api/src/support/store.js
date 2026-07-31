import db from '../db.js';

function addBusinessHours(isoStart, hours) {
  const d = new Date(isoStart.includes('T') ? isoStart : `${isoStart}Z`);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString();
}

export function listSlaPolicies() {
  return db.prepare('SELECT * FROM sla_policies ORDER BY plan_slug IS NOT NULL, plan_slug').all()
    .map(publicSlaPolicy);
}

export function getSlaPolicyForPlan(planSlug) {
  const specific = db.prepare('SELECT * FROM sla_policies WHERE plan_slug = ?').get(planSlug);
  if (specific) return specific;
  return db.prepare('SELECT * FROM sla_policies WHERE plan_slug IS NULL').get();
}

export function publicSlaPolicy(row) {
  if (!row) return null;
  return {
    id: row.id,
    planSlug: row.plan_slug,
    name: row.name,
    firstResponseHours: row.first_response_hours,
    resolutionHours: row.resolution_hours,
    businessHoursOnly: Boolean(row.business_hours_only),
    description: row.description,
  };
}

export function createTicket({ userId, subject, body, category, priority, planSlug }) {
  const sla = getSlaPolicyForPlan(planSlug || 'free');
  const now = new Date().toISOString();
  const dueFirst = sla ? addBusinessHours(now, sla.first_response_hours) : null;
  const dueResolution = sla?.resolution_hours ? addBusinessHours(now, sla.resolution_hours) : null;

  const result = db.prepare(`
    INSERT INTO support_tickets (user_id, subject, category, priority, status, sla_policy_id, due_first_response_at, due_resolution_at)
    VALUES (?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(userId, subject, category || 'general', priority || 'normal', sla?.id ?? null, dueFirst, dueResolution);

  const ticketId = result.lastInsertRowid;
  db.prepare(`
    INSERT INTO ticket_messages (ticket_id, author_user_id, body, is_staff)
    VALUES (?, ?, ?, 0)
  `).run(ticketId, userId, body);

  return findTicketById(ticketId);
}

export function findTicketById(id) {
  return db.prepare(`
    SELECT t.*, u.email AS user_email, p.name AS plan_name
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN plans p ON p.slug = (SELECT plan FROM users WHERE id = t.user_id)
    WHERE t.id = ?
  `).get(id);
}

export function publicTicket(row, { includeMessages = false } = {}) {
  if (!row) return null;
  const ticket = {
    id: row.id,
    subject: row.subject,
    status: row.status,
    priority: row.priority,
    category: row.category,
    userId: row.user_id,
    userEmail: row.user_email,
    planName: row.plan_name,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    dueFirstResponseAt: row.due_first_response_at,
    dueResolutionAt: row.due_resolution_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeMessages) {
    ticket.messages = listTicketMessages(row.id);
  }
  return ticket;
}

export function listTicketMessages(ticketId) {
  return db.prepare(`
    SELECT m.*, u.email AS author_email
    FROM ticket_messages m
    LEFT JOIN users u ON u.id = m.author_user_id
    WHERE m.ticket_id = ?
    ORDER BY m.created_at ASC
  `).all(ticketId).map((m) => ({
    id: m.id,
    body: m.body,
    isStaff: Boolean(m.is_staff),
    authorEmail: m.author_email || m.author_name,
    authorName: m.author_name,
    createdAt: m.created_at,
  }));
}

export function listUserTickets(userId, { limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT t.*, u.email AS user_email
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE t.user_id = ?
    ORDER BY t.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
  return rows.map((r) => publicTicket(r));
}

export function listAllTickets({ status, limit = 50, offset = 0, q = '' } = {}) {
  let sql = `
    SELECT t.*, u.email AS user_email
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE 1=1
  `;
  const params = [];
  if (status) {
    sql += ' AND t.status = ?';
    params.push(status);
  }
  if (q) {
    sql += ' AND (t.subject LIKE ? OR u.email LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY t.updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  let countSql = `
    SELECT COUNT(*) AS c FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    WHERE 1=1
  `;
  const countParams = [];
  if (status) {
    countSql += ' AND t.status = ?';
    countParams.push(status);
  }
  if (q) {
    countSql += ' AND (t.subject LIKE ? OR u.email LIKE ?)';
    countParams.push(`%${q}%`, `%${q}%`);
  }
  const total = db.prepare(countSql).get(...countParams)?.c ?? 0;
  return { tickets: rows.map((r) => publicTicket(r)), total };
}

export function addTicketMessage({ ticketId, authorUserId, body, isStaff = false, authorName = null }) {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId);
  if (!ticket) return null;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ticket_messages (ticket_id, author_user_id, author_name, body, is_staff)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticketId, authorUserId, authorName, body, isStaff ? 1 : 0);

  const updates = { updated_at: now };
  if (isStaff && !ticket.first_response_at) {
    updates.first_response_at = now;
  }
  if (!isStaff && ticket.status === 'resolved') {
    updates.status = 'open';
  }

  db.prepare(`
    UPDATE support_tickets SET
      updated_at = ?,
      first_response_at = COALESCE(?, first_response_at),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(now, updates.first_response_at ?? null, updates.status ?? null, ticketId);

  return findTicketById(ticketId);
}

export function updateTicketStatus(ticketId, status) {
  const now = new Date().toISOString();
  const resolvedAt = ['resolved', 'closed'].includes(status) ? now : null;
  db.prepare(`
    UPDATE support_tickets SET status = ?, updated_at = ?, resolved_at = COALESCE(?, resolved_at)
    WHERE id = ?
  `).run(status, now, resolvedAt, ticketId);
  return findTicketById(ticketId);
}

export function getSupportStats() {
  const open = db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('open','pending')").get().c;
  const breached = db.prepare(`
    SELECT COUNT(*) AS c FROM support_tickets
    WHERE status IN ('open','pending')
      AND due_first_response_at IS NOT NULL
      AND first_response_at IS NULL
      AND due_first_response_at < datetime('now')
  `).get().c;
  const today = db.prepare(`
    SELECT COUNT(*) AS c FROM support_tickets WHERE date(created_at) = date('now')
  `).get().c;
  return { open, slaBreached: breached, createdToday: today };
}
