import path from 'path';
import express from 'express';
import { IStateStore } from '../state/StateStore';
import { RuleEngine } from '../cre/RuleEngine';
import { buildRouter } from './routes';

export function createServer(store: IStateStore, cre: RuleEngine): express.Application {
  const app = express();
  app.use(express.json());
  app.use('/api', buildRouter(store, cre));
  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
  });
  return app;
}
