import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  addTicketMessage,
  findTicketById,
  getSupportStats,
  listAllTickets,
  listSlaPolicies,
  publicTicket,
  updateTicketStatus,
} from '../support/store.js';

function audit(req, action, targetType, targetId, details = null) {
  appendAuditLog({
    actorUserId: req.user?.userId ?? null,
    actorEmail: req.user?.email ?? null,
    action,
    targetType,
    targetId: targetId != null ? String(targetId) : null,
    details,
    ip: getClientIp(req),
  });
}

export function createSupportAdminRouter() {
  const router = Router();

  router.get('/stats', (_req, res) => {
    res.json(getSupportStats());
  });

  router.get('/sla', (_req, res) => {
    res.json({ policies: listSlaPolicies() });
  });

  router.get('/tickets', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json(listAllTickets({
      status: req.query.status || null,
      q: String(req.query.q || '').trim(),
      limit,
      offset,
    }));
  });

  router.get('/tickets/:id', (req, res) => {
    const row = findTicketById(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Ticket no encontrado' });
    res.json(publicTicket(row, { includeMessages: true }));
  });

  router.post('/tickets/:id/messages', (req, res) => {
    const ticketId = Number(req.params.id);
    const { body } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });
    const updated = addTicketMessage({
      ticketId,
      authorUserId: req.user.userId,
      body: body.trim(),
      isStaff: true,
    });
    if (!updated) return res.status(404).json({ error: 'Ticket no encontrado' });
    audit(req, 'ticket.reply', 'ticket', ticketId);
    res.json(publicTicket(updated, { includeMessages: true }));
  });

  router.patch('/tickets/:id', (req, res) => {
    const ticketId = Number(req.params.id);
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status requerido' });
    const updated = updateTicketStatus(ticketId, status);
    if (!updated) return res.status(404).json({ error: 'Ticket no encontrado' });
    audit(req, 'ticket.update', 'ticket', ticketId, { status });
    res.json(publicTicket(updated, { includeMessages: true }));
  });

  return router;
}
