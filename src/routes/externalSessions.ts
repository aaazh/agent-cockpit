import express from 'express';
import type { ExternalSessionSource } from '../services/externalSessionSource';
import { requireOwnerAuth } from '../middleware/monitorOnly';

export function createExternalSessionRouter(source: ExternalSessionSource | null, monitorOnly: boolean) {
  const router = express.Router();
  router.use(requireOwnerAuth);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/status', (_req, res) => {
    res.json({ enabled: source !== null, monitorOnly, pollIntervalMs: 4000 });
  });
  router.use((_req, res, next) => {
    if (!source) { res.status(503).json({ error: 'External session source is not configured' }); return; }
    next();
  });
  router.get('/runs', async (req, res) => {
    const cursor = req.query.cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 500)) {
      res.status(400).json({ error: 'Invalid cursor' }); return;
    }
    try { res.json(await source!.listRuns(cursor)); }
    catch { res.status(502).json({ error: 'Monitoring source unavailable. Try again shortly.' }); }
  });
  router.get('/runs/:id/transcript', async (req, res) => {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid run id' }); return;
    }
    try { res.json(await source!.getTranscript(req.params.id)); }
    catch { res.status(502).json({ error: 'Monitoring source unavailable. Try again shortly.' }); }
  });
  return router;
}
