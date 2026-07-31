import { Router } from 'express';
import { appendAuditLog } from '../audit.js';
import { getClientIp } from '../middleware/clientIp.js';
import {
  createAutoRule,
  deleteAutoRule,
  findContributionById,
  getCommunityStats,
  listAutoApprovalRules,
  listContributions,
  publicAutoRule,
  publicContribution,
  reviewContribution,
} from '../community/store.js';

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

export function createCommunityAdminRouter() {
  const router = Router();

  router.get('/stats', (_req, res) => {
    res.json(getCommunityStats());
  });

  router.get('/contributions', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    res.json({
      contributions: listContributions({
        status: req.query.status || null,
        limit,
        offset,
      }),
    });
  });

  router.get('/contributions/:id', (req, res) => {
    const row = findContributionById(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'Contribución no encontrada' });
    res.json(publicContribution(row));
  });

  router.patch('/contributions/:id', (req, res) => {
    const id = Number(req.params.id);
    const { status, reviewNotes } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'status debe ser approved o rejected' });
    }
    const updated = reviewContribution(id, {
      status,
      reviewNotes,
      reviewerUserId: req.user.userId,
    });
    if (!updated) return res.status(404).json({ error: 'Contribución no encontrada' });
    audit(req, `contribution.${status}`, 'contribution', id, { reviewNotes });
    res.json(publicContribution(updated));
  });

  router.get('/auto-rules', (_req, res) => {
    res.json({ rules: listAutoApprovalRules() });
  });

  router.post('/auto-rules', (req, res) => {
    const { name, authorType, targetArea, trustedEmailDomain, autoApprove } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    const row = createAutoRule({
      name: name.trim(),
      authorType,
      targetArea,
      trustedEmailDomain,
      autoApprove: autoApprove !== false,
    });
    audit(req, 'community.auto_rule_create', 'community_rule', row.id);
    res.status(201).json(publicAutoRule(row));
  });

  router.delete('/auto-rules/:id', (req, res) => {
    deleteAutoRule(Number(req.params.id));
    audit(req, 'community.auto_rule_delete', 'community_rule', req.params.id);
    res.json({ ok: true });
  });

  return router;
}
