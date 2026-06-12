import path from 'path';
import express from 'express';
import { IStateStore } from '../state/StateStore';
import { RuleEngine } from '../fre/RuleEngine';
import { buildRouter } from './routes';

export function createServer(store: IStateStore, fre: RuleEngine): express.Application {
  const app = express();

  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
  });

  app.use(express.json());
  app.use('/api', buildRouter(store, fre));

  return app;
}
