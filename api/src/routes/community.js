import { Router } from 'express';
import {
  createContribution,
  listContributions,
  publicContribution,
} from '../community/store.js';

export function createCommunityRouter() {
  const router = Router();

  router.get('/contributions', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const offset = Number(req.query.offset) || 0;
    res.json({
      contributions: listContributions({ publicOnly: true, limit, offset }),
    });
  });

  router.post('/contributions', (req, res) => {
    const {
      title, description, authorName, authorEmail, authorType,
      sourceUrl, patchContent, targetArea,
    } = req.body || {};

    if (!title?.trim() || !authorName?.trim()) {
      return res.status(400).json({ error: 'Título y autor requeridos' });
    }
    if (!description?.trim() && !patchContent?.trim() && !sourceUrl?.trim()) {
      return res.status(400).json({ error: 'Descripción, parche o URL de origen requeridos' });
    }

    const row = createContribution({
      title: title.trim(),
      description,
      authorName: authorName.trim(),
      authorEmail,
      authorType: ['human', 'ai', 'bot'].includes(authorType) ? authorType : 'human',
      sourceUrl,
      patchContent,
      targetArea,
    });

    const pub = publicContribution(row);
    res.status(201).json({
      contribution: pub,
      autoApproved: pub.autoApproved,
      message: pub.autoApproved
        ? 'Contribución aprobada automáticamente según las reglas de la comunidad.'
        : 'Contribución enviada. Un administrador la revisará pronto.',
    });
  });

  return router;
}
