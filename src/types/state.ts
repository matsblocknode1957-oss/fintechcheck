export interface AssetPrice {
  asset: string;
  price: number;
  peg: number;
  deviationBps: number;
  lastUpdated: number;
}

export interface PoRRecord {
  asset: string;
  collateralizationRatio: number;
  lastUpdated: number;
}

export interface LiquidationRecord {
  protocol: string;
  collateralAsset: string;
  debtAsset: string;
  collateralSeized: number;
  debtRepaid: number;
  timestamp: number;
}

export interface FlowRecord {
  asset: string;
  netFlow: number;    // positive = net inflow, negative = net outflow
  usdVolume: number;
  timestamp: number;
}

export interface SystemState {
  prices: Map<string, AssetPrice>;
  porRecords: Map<string, PoRRecord>;
  recentLiquidations: LiquidationRecord[];
  recentFlows: FlowRecord[];
  lastRiskSnapshot?: {
    pegStress: number;
    liquidationStress: number;
    flowPressure: number;
    composite: number;
    timestamp: number;
  };
}
