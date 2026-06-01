import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, RiskSnapshotData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';

const SCORE_INTERVAL_MS = 10_000;

// Per-coin thresholds — bps subtracted before a coin contributes to peg stress.
// LUSD/MKUSD have wider operating bands; only excess beyond ±60 bps drives the score.
const PEG_THRESHOLDS: Record<string, number> = {
  LUSD:  60,
  MKUSD: 60,
};

// Approximate market caps in $M (order of magnitude, not real-time).
// Used to weight peg stress: USDT/USDC depegging matters far more than ALUSD.
const MARKET_CAPS: Record<string, number> = {
  USDT:   140_000,
  USDC:    60_000,
  USDS:     8_000,
  ETHENA:   5_000,
  PYUSD:      700,
  FDUSD:    2_000,
  RLUSD:      300,
  TUSD:       400,
  FRAX:       500,
  GHO:        200,
  CRVUSD:     800,
  LUSD:       300,
  USDP:       100,
  USDD:       700,
  MKUSD:       50,
  EURC:       400,
  DOLA:        80,
  ALUSD:       30,
  BOLD:        20,
};

const TOTAL_MARKET_CAP = Object.values(MARKET_CAPS).reduce((s, v) => s + v, 0);
// 200 bps effective deviation = full contribution from a coin toward peg stress
const MAX_DEV_BPS = 200;

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
    // Snapshot current prices first so correlation compares current vs previous cycle
    const priceSnap: Record<string, number> = {};
    for (const p of this.store.getAllPrices().filter(p => p.peg > 0)) {
      priceSnap[p.asset] = p.price;
    }
    this.store.pushPriceSnapshot(priceSnap);

    const pegStress = this.scorePegStress();
    const liquidationStress = this.scoreLiquidationStress();
    const flowPressure = this.scoreFlowPressure();
    const { corrScore, correlatedCoins } = this.scoreCorrelation();
    // 4-input composite: peg 35%, liq 30%, flow 20%, corr 15%
    const composite = Math.round(
      pegStress * 0.35 + liquidationStress * 0.30 + flowPressure * 0.20 + corrScore * 0.15
    );

    const snapshot = {
      pegStress,
      liquidationStress,
      flowPressure,
      corrScore,
      correlatedCoins,
      composite,
      timestamp: Date.now(),
      perCoin: this.scorePerCoin(),
    };
    this.store.setRiskSnapshot(snapshot);

    const event: FintechEvent<RiskSnapshotData> = {
      id: uuidv4(),
      type: 'RISK_SNAPSHOT',
      source: 'PegCheck',
      chainId: this.chainId,
      timestamp: Date.now(),
      data: { ...snapshot, triggeredRules: [] },
    };
    eventBus.publish(event);
  }

  // ─── Scorers ────────────────────────────────────────────────────────────────

  private scoreCorrelation(): { corrScore: number; correlatedCoins: string[] } {
    const history = this.store.getPriceHistory();
    if (history.length < 3) return { corrScore: 0, correlatedCoins: [] };

    // Build per-coin price series — only include coins present in every snapshot
    const lastPrices = history[history.length - 1].prices;
    const series: Record<string, number[]> = {};
    for (const coin of Object.keys(lastPrices)) {
      const vals = history.map(h => h.prices[coin]);
      if (vals.every(v => v !== undefined)) series[coin] = vals as number[];
    }

    const coins = Object.keys(series);
    if (coins.length < 2) return { corrScore: 0, correlatedCoins: [] };

    const pearson = (xs: number[], ys: number[]): number => {
      const n = xs.length;
      const meanX = xs.reduce((s, v) => s + v, 0) / n;
      const meanY = ys.reduce((s, v) => s + v, 0) / n;
      let num = 0, denomX = 0, denomY = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        num += dx * dy;
        denomX += dx * dx;
        denomY += dy * dy;
      }
      const denom = Math.sqrt(denomX * denomY);
      return denom === 0 ? 0 : num / denom;
    };

    const THRESHOLD = 0.7;
    let sigSum = 0;
    let sigCount = 0;
    const correlatedSet = new Set<string>();

    for (let i = 0; i < coins.length; i++) {
      for (let j = i + 1; j < coins.length; j++) {
        const r = Math.abs(pearson(series[coins[i]], series[coins[j]]));
        if (r >= THRESHOLD) {
          sigSum += r;
          sigCount++;
          correlatedSet.add(coins[i]);
          correlatedSet.add(coins[j]);
        }
      }
    }

    if (sigCount === 0) return { corrScore: 0, correlatedCoins: [] };

    // Scale average r from [0.7, 1.0] → [0, 100]
    const avgR = sigSum / sigCount;
    const corrScore = Math.min(100, Math.round(((avgR - THRESHOLD) / (1 - THRESHOLD)) * 100));
    return { corrScore, correlatedCoins: Array.from(correlatedSet) };
  }

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

    // Market-cap-weighted peg stress.
    // Each coin contributes: (effectiveDev / MAX_DEV_BPS) * (marketCap / totalMarketCap) * 100
    // Coins not in MARKET_CAPS get a 1 $M weight (negligible).
    // Sum of all weights = 1, so the result is naturally 0–100.
    let weighted = 0;
    for (const p of prices) {
      const mcap = MARKET_CAPS[p.asset] ?? 1;
      const normalizedDev = Math.min(this.effectiveDev(p.asset, p.deviationBps) / MAX_DEV_BPS, 1);
      weighted += normalizedDev * (mcap / TOTAL_MARKET_CAP) * 100;
    }
    return Math.min(100, Math.round(weighted));
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
