import { Router, Request, Response } from 'express';
import { IStateStore } from '../state/StateStore';
import { RuleEngine } from '../cre/RuleEngine';

export function buildRouter(store: IStateStore, cre: RuleEngine): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', ts: Date.now() });
  });

  router.get('/risk', (_req: Request, res: Response) => {
    const snapshot = store.getRiskSnapshot();
    if (!snapshot) {
      res.status(503).json({ error: 'Risk snapshot not yet computed' });
      return;
    }
    res.json(snapshot);
  });

  router.get('/prices', (_req: Request, res: Response) => {
    res.json(store.getAllPrices());
  });

  router.get('/prices/:asset', (req: Request, res: Response) => {
    const price = store.getPrice(req.params.asset.toUpperCase());
    if (!price) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }
    res.json(price);
  });

  router.get('/liquidations', (_req: Request, res: Response) => {
    res.json(store.getRecentLiquidations());
  });

  router.get('/flows', (_req: Request, res: Response) => {
    res.json(store.getRecentFlows());
  });

  router.get('/alerts', (req: Request, res: Response) => {
    const limit = parseInt(req.query['limit'] as string ?? '50', 10);
    res.json(cre.getAlertHistory(isNaN(limit) ? 50 : limit));
  });

  router.get('/state', (_req: Request, res: Response) => {
    const snap = store.snapshot();
    // Convert Maps to plain objects for JSON serialization
    res.json({
      prices: Object.fromEntries(snap.prices),
      porRecords: Object.fromEntries(snap.porRecords),
      recentLiquidations: snap.recentLiquidations,
      recentFlows: snap.recentFlows,
      lastRiskSnapshot: snap.lastRiskSnapshot,
    });
  });

  return router;
}
