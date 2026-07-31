import { Router } from 'express';
import { getUserLimits } from '../db.js';
import {
  addTicketMessage,
  createTicket,
  findTicketById,
  listSlaPolicies,
  listUserTickets,
  publicSlaPolicy,
  publicTicket,
} from '../support/store.js';

export function createSupportRouter({ authRequired }) {
  const router = Router();

  router.get('/sla', (_req, res) => {
    res.json({ policies: listSlaPolicies() });
  });

  router.get('/tickets', authRequired, (req, res) => {
    res.json({ tickets: listUserTickets(req.dbUser.id) });
  });

  router.post('/tickets', authRequired, (req, res) => {
    const { subject, body, category, priority } = req.body || {};
    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Asunto y mensaje requeridos' });
    }
    const limits = getUserLimits(req.dbUser);
    const row = createTicket({
      userId: req.dbUser.id,
      subject: subject.trim(),
      body: body.trim(),
      category,
      priority: limits.features?.prioritySupport ? (priority || 'high') : (priority || 'normal'),
      planSlug: req.dbUser.plan,
    });
    res.status(201).json(publicTicket(row, { includeMessages: true }));
  });

  router.get('/tickets/:id', authRequired, (req, res) => {
    const row = findTicketById(Number(req.params.id));
    if (!row || row.user_id !== req.dbUser.id) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }
    res.json(publicTicket(row, { includeMessages: true }));
  });

  router.post('/tickets/:id/messages', authRequired, (req, res) => {
    const ticketId = Number(req.params.id);
    const row = findTicketById(ticketId);
    if (!row || row.user_id !== req.dbUser.id) {
      return res.status(404).json({ error: 'Ticket no encontrado' });
    }
    const { body } = req.body || {};
    if (!body?.trim()) return res.status(400).json({ error: 'Mensaje requerido' });
    const updated = addTicketMessage({
      ticketId,
      authorUserId: req.dbUser.id,
      body: body.trim(),
      isStaff: false,
    });
    res.json(publicTicket(updated, { includeMessages: true }));
  });

  return router;
}
