import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, RiskSnapshotData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';

const SCORE_INTERVAL_MS = 10_000;

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

  private scorePegStress(): number {
    const prices = this.store.getAllPrices().filter(p => p.peg > 0);
    if (prices.length === 0) return 0;

    // Max absolute deviation in bps across all pegged assets, capped at 200bps = 100 score
    const maxDevBps = Math.max(...prices.map(p => Math.abs(p.deviationBps)));
    return Math.min(100, Math.round((maxDevBps / 200) * 100));
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
