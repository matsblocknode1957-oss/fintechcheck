/**
 * Unified event schema for all FintechCheck data flows.
 * Every piece of data entering the system is wrapped in a FintechEvent.
 * This is the single contract between ingestion, state, risk, and FRE layers.
 */

export type EventSource = 'PegCheck' | 'LiquidLens' | 'ChainlinkPoR';

export type EventType =
  // PegCheck
  | 'PRICE_UPDATE'
  | 'PEG_DEVIATION'
  | 'POR_ATTESTATION'
  // LiquidLens
  | 'LIQUIDATION'
  | 'MINT'
  | 'BURN'
  | 'WHALE_TRANSFER'
  // Internal
  | 'RISK_SNAPSHOT'
  | 'FRE_ALERT';

export interface FintechEvent<T = unknown> {
  id: string;
  type: EventType;
  source: EventSource;
  chainId: number;
  timestamp: number;       // Unix ms
  blockNumber?: number;
  data: T;
}

// ─── PegCheck payloads ────────────────────────────────────────────────────────

export interface PriceUpdateData {
  asset: string;           // e.g. "USDC", "DAI", "FRAX"
  priceFeed: string;       // feed identifier
  price: number;           // USD price
  confidence?: number;     // 0–1 Pyth confidence
  peg?: number;            // authoritative peg from the source (overrides processor lookup)
}

export interface PegDeviationData {
  asset: string;
  peg: number;             // target peg (usually 1.0)
  price: number;
  deviationBps: number;    // basis points from peg
}

export interface PoRAttestationData {
  asset: string;
  reserveAddress: string;
  reportedReserves: bigint;
  circulatingSupply: bigint;
  collateralizationRatio: number;  // reserves / supply
}

// ─── LiquidLens payloads ──────────────────────────────────────────────────────

export interface LiquidationData {
  protocol: string;
  borrower: string;
  collateralAsset: string;
  debtAsset: string;
  collateralSeized: number;
  debtRepaid: number;
  healthFactorBefore: number;
}

export interface MintBurnData {
  protocol: string;
  asset: string;
  amount: number;
  actor: string;
  isMint: boolean;
  txHash?: string;
}

export interface WhaleTransferData {
  asset: string;
  from: string;
  to: string;
  amount: number;
  usdValue: number;
  txHash?: string;
}

// ─── Internal payloads ────────────────────────────────────────────────────────

export interface RiskSnapshotData {
  pegStress: number;           // 0–100
  liquidationStress: number;   // 0–100
  flowPressure: number;        // 0–100
  corrScore: number;           // 0–100 cross-coin correlation score
  composite: number;           // weighted composite 0–100
  triggeredRules: string[];
  perCoin?: Record<string, number>;
  correlatedCoins?: string[];  // assets dropping simultaneously when corrScore > 0
}

export interface FREAlertData {
  ruleId: string;
  ruleName: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  context: Record<string, unknown>;
}
