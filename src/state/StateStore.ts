import { AssetPrice, PoRRecord, LiquidationRecord, FlowRecord, SystemState } from '../types';

/**
 * StateStore interface — designed so an in-memory impl and a Redis-backed impl
 * are interchangeable without touching any other layer.
 */
export interface IStateStore {
  // Prices
  setPrice(asset: string, data: AssetPrice): void;
  getPrice(asset: string): AssetPrice | undefined;
  getAllPrices(): AssetPrice[];

  // Proof-of-Reserves
  setPoR(asset: string, data: PoRRecord): void;
  getPoR(asset: string): PoRRecord | undefined;

  // Liquidations (rolling window)
  addLiquidation(record: LiquidationRecord): void;
  getRecentLiquidations(windowMs?: number): LiquidationRecord[];

  // Whale flows (rolling window)
  addFlow(record: FlowRecord): void;
  getRecentFlows(windowMs?: number): FlowRecord[];

  // Risk snapshot
  setRiskSnapshot(snapshot: SystemState['lastRiskSnapshot']): void;
  getRiskSnapshot(): SystemState['lastRiskSnapshot'];

  snapshot(): SystemState;
}

const LIQUIDATION_WINDOW_MS = 60 * 60 * 1000;   // 1 hour
const FLOW_WINDOW_MS = 60 * 60 * 1000;

export class InMemoryStateStore implements IStateStore {
  private prices = new Map<string, AssetPrice>();
  private porRecords = new Map<string, PoRRecord>();
  private liquidations: LiquidationRecord[] = [];
  private flows: FlowRecord[] = [];
  private riskSnapshot: SystemState['lastRiskSnapshot'];

  setPrice(asset: string, data: AssetPrice): void {
    this.prices.set(asset, data);
  }

  getPrice(asset: string): AssetPrice | undefined {
    return this.prices.get(asset);
  }

  getAllPrices(): AssetPrice[] {
    return Array.from(this.prices.values());
  }

  setPoR(asset: string, data: PoRRecord): void {
    this.porRecords.set(asset, data);
  }

  getPoR(asset: string): PoRRecord | undefined {
    return this.porRecords.get(asset);
  }

  addLiquidation(record: LiquidationRecord): void {
    this.liquidations.push(record);
    this.prune();
  }

  getRecentLiquidations(windowMs = LIQUIDATION_WINDOW_MS): LiquidationRecord[] {
    const cutoff = Date.now() - windowMs;
    return this.liquidations.filter(l => l.timestamp >= cutoff);
  }

  addFlow(record: FlowRecord): void {
    this.flows.push(record);
    this.prune();
  }

  getRecentFlows(windowMs = FLOW_WINDOW_MS): FlowRecord[] {
    const cutoff = Date.now() - windowMs;
    return this.flows.filter(f => f.timestamp >= cutoff);
  }

  setRiskSnapshot(snapshot: SystemState['lastRiskSnapshot']): void {
    this.riskSnapshot = snapshot;
  }

  getRiskSnapshot(): SystemState['lastRiskSnapshot'] {
    return this.riskSnapshot;
  }

  snapshot(): SystemState {
    return {
      prices: new Map(this.prices),
      porRecords: new Map(this.porRecords),
      recentLiquidations: [...this.liquidations],
      recentFlows: [...this.flows],
      lastRiskSnapshot: this.riskSnapshot,
    };
  }

  private prune(): void {
    const cutoff = Date.now() - Math.max(LIQUIDATION_WINDOW_MS, FLOW_WINDOW_MS);
    this.liquidations = this.liquidations.filter(l => l.timestamp >= cutoff);
    this.flows = this.flows.filter(f => f.timestamp >= cutoff);
  }
}
