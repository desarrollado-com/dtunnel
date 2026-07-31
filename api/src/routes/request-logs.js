import { Router } from 'express';
import {
  getRequestTraceStats,
  listRequestTraces,
  userOwnsSubdomain,
} from '../request-trace.js';

export function createRequestLogsRouter({ authRequired }) {
  const router = Router();

  router.get('/', authRequired, (req, res) => {
    const subdomain = req.query.subdomain || null;
    if (subdomain && !userOwnsSubdomain(req.user.userId, subdomain)) {
      return res.status(403).json({ error: 'No tienes acceso a este subdominio' });
    }
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { traces, total } = listRequestTraces({
      userId: req.user.userId,
      subdomain,
      limit,
      offset,
    });
    res.json({ traces, total, limit, offset });
  });

  router.get('/stats', authRequired, (req, res) => {
    res.json(getRequestTraceStats(req.user.userId));
  });

  return router;
}
