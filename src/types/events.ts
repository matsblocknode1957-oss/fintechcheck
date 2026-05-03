/**
 * Unified event schema for all FintechCheck data flows.
 * Every piece of data entering the system is wrapped in a FintechEvent.
 * This is the single contract between ingestion, state, risk, and CRE layers.
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
  | 'CRE_ALERT';

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
}

export interface WhaleTransferData {
  asset: string;
  from: string;
  to: string;
  amount: number;
  usdValue: number;
}

// ─── Internal payloads ────────────────────────────────────────────────────────

export interface RiskSnapshotData {
  pegStress: number;           // 0–100
  liquidationStress: number;   // 0–100
  flowPressure: number;        // 0–100
  composite: number;           // weighted composite 0–100
  triggeredRules: string[];
}

export interface CREAlertData {
  ruleId: string;
  ruleName: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  context: Record<string, unknown>;
}
