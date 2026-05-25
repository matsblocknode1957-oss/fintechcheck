import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, RiskSnapshotData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';

const SCORE_INTERVAL_MS = 10_000;

// Coins with a wider acceptable trading range before contributing to peg stress.
// Deviation within the threshold is considered normal and ignored by the scorer.
const PEG_THRESHOLDS: Record<string, number> = {
  LUSD:  50,   // algorithmic; routinely trades ±50 bps
  MKUSD: 50,   // Prisma mkUSD; same operating tolerance
};

/**
 * Risk scoring engine — runs on a fixed interval and after key events.
 * Emits RISK_SNAPSHOT events that the CRE rule engine consumes.
 *
 * Scoring is intentionally simple (0–100 linear scales) so thresholds
 * are readable and auditable without ML opacity.
 */
export class RiskEngine {
  private timer?: NodeJS.Timeout;

  constructor(
    private store: IStateStore,
    private chainId: number,
  ) {}

  start(): void {
    // Re-score after every peg deviation or liquidation
    eventBus.subscribe('PEG_DEVIATION', () => this.score());
    eventBus.subscribe('LIQUIDATION', () => this.score());
    // Also score on schedule
    this.timer = setInterval(() => this.score(), SCORE_INTERVAL_MS);
    console.log('[RiskEngine] Started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  score(): void {
    const pegStress = this.scorePegStress();
    const liquidationStress = this.scoreLiquidationStress();
    const flowPressure = this.scoreFlowPressure();
    const composite = Math.round(pegStress * 0.4 + liquidationStress * 0.35 + flowPressure * 0.25);

    const snapshot = {
      pegStress,
      liquidationStress,
      flowPressure,
      composite,
      timestamp: Date.now(),
      perCoin: this.scorePerCoin(),
    };
    this.store.setRiskSnapshot(snapshot);

    const event: FintechEvent<RiskSnapshotData> = {
      id: uuidv4(),
      type: 'RISK_SNAPSHOT',
      source: 'PegCheck',   // internal — source doesn't matter
      chainId: this.chainId,
      timestamp: Date.now(),
      data: { ...snapshot, triggeredRules: [] },
    };
    eventBus.publish(event);
  }

  // ─── Scorers ────────────────────────────────────────────────────────────────

  private effectiveDev(asset: string, deviationBps: number): number {
    const threshold = PEG_THRESHOLDS[asset] ?? 0;
    return Math.max(0, Math.abs(deviationBps) - threshold);
  }

  private scorePerCoin(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const p of this.store.getAllPrices()) {
      if (p.peg === 0) continue;
      result[p.asset] = Math.min(100, Math.round((this.effectiveDev(p.asset, p.deviationBps) / 200) * 100));
    }
    return result;
  }

  private scorePegStress(): number {
    const prices = this.store.getAllPrices().filter(p => p.peg > 0);
    if (prices.length === 0) return 0;

    // Max effective deviation across all pegged assets; 200 bps excess = 100 score.
    // Per-coin thresholds (e.g. LUSD ±50 bps) are subtracted before scoring.
    const maxEff = Math.max(...prices.map(p => this.effectiveDev(p.asset, p.deviationBps)));
    return Math.min(100, Math.round((maxEff / 200) * 100));
  }

  private scoreLiquidationStress(): number {
    const recent = this.store.getRecentLiquidations();
    // Volume of debt repaid in last hour; $10M+ = 100 score
    const totalDebtRepaid = recent.reduce((sum, l) => sum + l.debtRepaid, 0);
    return Math.min(100, Math.round((totalDebtRepaid / 10_000_000) * 100));
  }

  private scoreFlowPressure(): number {
    const recent = this.store.getRecentFlows();
    // Net outflow magnitude; $50M+ net outflow = 100 score
    const netFlow = recent.reduce((sum, f) => sum + f.netFlow, 0);
    if (netFlow >= 0) return 0;   // inflow or neutral = no pressure
    return Math.min(100, Math.round((Math.abs(netFlow) / 50_000_000) * 100));
  }
}
