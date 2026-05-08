import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, LiquidationData, MintBurnData, WhaleTransferData } from '../../types';
import { eventBus } from '../../bus/EventBus';

// ── Contract addresses ────────────────────────────────────────────────────────

const AAVE_V3_POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const USDC         = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT         = '0xdac17f958d2ee523a2206206994597c13d831ec7';

// ── Event topic hashes ────────────────────────────────────────────────────────

// keccak256("LiquidationCall(address,address,address,uint256,uint256,address,bool)")
const LIQUIDATION_TOPIC0 = '0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286';
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC0    = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ── Poll config ───────────────────────────────────────────────────────────────

const ETH_RPC          = 'https://ethereum.publicnode.com';
const POLL_INTERVAL_MS = 60_000;
const LIQN_LOOKBACK    = 300;    // blocks ≈ 1 hour   (liquidations are rare)
const XFER_LOOKBACK    = 50;     // blocks ≈ 10 min   (transfers are high-volume)
const MAX_BLOCK_RANGE  = 2_000;  // Alchemy free tier hard limit for eth_getLogs
const WHALE_USD_MIN    = 1_000_000;

// ── Token metadata ────────────────────────────────────────────────────────────

const TOKEN_SYMBOLS: Record<string, string> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 'wstETH',
  '0xae78736cd615f374d3085123a210448e74fc6393': 'rETH',
  '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f': 'GHO',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
  '0x5f98805a4e8be255a32880fdec7f6728c6568ba0': 'LUSD',
};

const TOKEN_DECIMALS: Record<string, number> = {
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,   // USDC
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,   // USDT
  '0x6b175474e89094c44da98b954eedeac495271d0f': 18,  // DAI
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18,  // WETH
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,   // WBTC
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': 18,  // wstETH
  '0xae78736cd615f374d3085123a210448e74fc6393': 18,  // rETH
  '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f': 18,  // GHO
  '0x514910771af9ca656af840dff83e8264ecf986ca': 18,  // LINK
  '0x5f98805a4e8be255a32880fdec7f6728c6568ba0': 18,  // LUSD
};

// Static USD price approximations — only used for risk-scoring magnitude.
const TOKEN_USD_PRICE: Record<string, number> = {
  USDC: 1, USDT: 1, DAI: 1, GHO: 1, LUSD: 1,
  WETH: 3000, wstETH: 3200, rETH: 3100,
  WBTC: 65000,
  LINK: 15,
};

// ── Raw log types ─────────────────────────────────────────────────────────────

interface EthLog {
  address:         string;
  topics:          string[];
  data:            string;
  blockNumber:     string;
  transactionHash: string;
}

interface ParsedTransfer {
  from:  string;
  to:    string;
  value: bigint;
  token: string;  // lowercase contract address
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function symbolOf(addr: string): string {
  return TOKEN_SYMBOLS[addr.toLowerCase()] ?? `${addr.slice(0, 8)}…`;
}

function toUsd(raw: bigint, addr: string): number {
  const key      = addr.toLowerCase();
  const decimals = TOKEN_DECIMALS[key] ?? 18;
  const symbol   = TOKEN_SYMBOLS[key]  ?? '';
  const price    = TOKEN_USD_PRICE[symbol] ?? 1;
  return (Number(raw) / 10 ** decimals) * price;
}

/**
 * Decodes an Aave v3 LiquidationCall log.
 *
 * Signature:
 *   LiquidationCall(
 *     address indexed collateralAsset,    → topics[1]
 *     address indexed debtAsset,          → topics[2]
 *     address indexed user,               → topics[3]
 *     uint256 debtToCover,                → data[0..31]
 *     uint256 liquidatedCollateralAmount, → data[32..63]
 *     address liquidator,                 → data[64..95]
 *     bool receiveAToken                  → data[96..127]
 *   )
 */
function parseLiquidationLog(log: EthLog): LiquidationData | null {
  try {
    if (log.topics.length < 4) return null;
    const collateralAddr = '0x' + log.topics[1].slice(26).toLowerCase();
    const debtAddr       = '0x' + log.topics[2].slice(26).toLowerCase();
    const borrower       = '0x' + log.topics[3].slice(26).toLowerCase();
    const hex = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    if (hex.length < 256) return null;
    const debtToCover          = BigInt('0x' + hex.slice(0,   64));
    const liquidatedCollateral = BigInt('0x' + hex.slice(64, 128));
    return {
      protocol:           'Aave-v3',
      borrower,
      collateralAsset:    symbolOf(collateralAddr),
      debtAsset:          symbolOf(debtAddr),
      collateralSeized:   toUsd(liquidatedCollateral, collateralAddr),
      debtRepaid:         toUsd(debtToCover, debtAddr),
      healthFactorBefore: 0,  // not in log; requires a separate eth_call
    };
  } catch {
    return null;
  }
}

/**
 * Decodes an ERC-20 Transfer log.
 *
 * Signature:
 *   Transfer(address indexed from, address indexed to, uint256 value)
 *     → topics[1] = from, topics[2] = to, data = value (uint256)
 */
function parseTransferLog(log: EthLog): ParsedTransfer | null {
  try {
    if (log.topics.length < 3) return null;
    const from  = '0x' + log.topics[1].slice(26).toLowerCase();
    const to    = '0x' + log.topics[2].slice(26).toLowerCase();
    const hex   = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
    if (hex.length < 64) return null;
    const value = BigInt('0x' + hex.slice(0, 64));
    return { from, to, value, token: log.address.toLowerCase() };
  } catch {
    return null;
  }
}

// ── Adaptor ───────────────────────────────────────────────────────────────────

export class LiquidLensAdaptor {
  private readonly chainId: number;
  private lastBlock = 0;
  private timer?: NodeJS.Timeout;
  private reqId    = 0;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  start(): void {
    console.log('[LiquidLens] Polling Aave v3 liquidations + USDC/USDT transfers via ' + ETH_RPC);
    this.poll().catch((err) => console.error('[LiquidLens] Initial poll failed:', err));
    this.timer = setInterval(
      () => this.poll().catch((err) => console.error('[LiquidLens] Poll failed:', err)),
      POLL_INTERVAL_MS,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const id      = ++this.reqId;
    const reqBody = JSON.stringify({ jsonrpc: '2.0', method, params, id });
    console.log(`[LiquidLens] RPC req  → ${method} ${reqBody}`);

    const res  = await fetch(ETH_RPC, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    reqBody,
    });

    // Always read the body first so errors include the RPC's own message.
    const text = await res.text();
    console.log(`[LiquidLens] RPC resp ← HTTP ${res.status} ${text.slice(0, 300)}`);

    if (!res.ok) {
      throw new Error(`[LiquidLens] RPC HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const parsed = JSON.parse(text) as { result?: T; error?: { message: string; code?: number } };
    if (parsed.error) {
      throw new Error(`[LiquidLens] RPC error ${parsed.error.code ?? ''}: ${parsed.error.message}`);
    }
    return parsed.result as T;
  }

  private async poll(): Promise<void> {
    const latest  = parseInt(await this.rpc<string>('eth_blockNumber', []), 16);
    const isFirst = this.lastBlock === 0;

    // Different lookback windows: liquidations are rare (300 blocks fine);
    // USDC+USDT transfers are high-volume so we limit to 50 blocks on first poll.
    // Both ranges are capped at MAX_BLOCK_RANGE to satisfy Alchemy's eth_getLogs limit.
    const liqFrom  = Math.max(isFirst ? latest - LIQN_LOOKBACK : this.lastBlock + 1, latest - MAX_BLOCK_RANGE);
    const xferFrom = Math.max(isFirst ? latest - XFER_LOOKBACK  : this.lastBlock + 1, latest - MAX_BLOCK_RANGE);

    if (liqFrom > latest) return;

    // Fetch both event types in parallel to minimise wall-clock latency.
    const [liqLogs, xferLogs] = await Promise.all([
      this.rpc<EthLog[]>('eth_getLogs', [{
        address:   AAVE_V3_POOL,
        topics:    [LIQUIDATION_TOPIC0],
        fromBlock: `0x${liqFrom.toString(16)}`,
        toBlock:   `0x${latest.toString(16)}`,
      }]),
      this.rpc<EthLog[]>('eth_getLogs', [{
        address:   [USDC, USDT],   // single request covers both tokens
        topics:    [TRANSFER_TOPIC0],
        fromBlock: `0x${xferFrom.toString(16)}`,
        toBlock:   `0x${latest.toString(16)}`,
      }]),
    ]);

    this.lastBlock = latest;

    // ── Liquidations ─────────────────────────────────────────────────────────
    let liqCount = 0;
    for (const log of liqLogs) {
      const data = parseLiquidationLog(log);
      if (!data) continue;
      this.injectLiquidation(data, parseInt(log.blockNumber, 16));
      liqCount++;
    }
    console.log(
      liqCount > 0
        ? `[LiquidLens] ${liqCount} liquidation(s) in blocks ${liqFrom}–${latest}`
        : `[LiquidLens] No liquidations in blocks ${liqFrom}–${latest}`,
    );

    // ── Transfers: mint / burn / whale ────────────────────────────────────────
    let mintCount = 0, burnCount = 0, whaleCount = 0;

    for (const log of xferLogs) {
      const parsed = parseTransferLog(log);
      if (!parsed) continue;

      const { from, to, value, token } = parsed;
      const blockNum = parseInt(log.blockNumber, 16);
      const asset    = symbolOf(token);

      if (from === ZERO_ADDR) {
        // New supply minted (e.g. Circle issuing USDC)
        this.injectMintBurn(
          { protocol: asset, asset, amount: toUsd(value, token), actor: to, isMint: true },
          blockNum,
        );
        mintCount++;
      } else if (to === ZERO_ADDR) {
        // Supply burned (e.g. USDC redemption)
        this.injectMintBurn(
          { protocol: asset, asset, amount: toUsd(value, token), actor: from, isMint: false },
          blockNum,
        );
        burnCount++;
      } else {
        // Regular transfer — emit whale event only if above threshold
        const usdValue = toUsd(value, token);
        if (usdValue >= WHALE_USD_MIN) {
          const decimals = TOKEN_DECIMALS[token] ?? 18;
          this.injectWhaleTransfer(
            { asset, from, to, amount: Number(value) / 10 ** decimals, usdValue },
            blockNum,
          );
          whaleCount++;
        }
      }
    }

    if (mintCount || burnCount)
      console.log(`[LiquidLens] ${mintCount} mint(s), ${burnCount} burn(s) in blocks ${xferFrom}–${latest}`);
    if (whaleCount)
      console.log(`[LiquidLens] ${whaleCount} whale transfer(s) ≥$${(WHALE_USD_MIN / 1_000_000).toFixed(0)}M`);
  }

  // ── Manual injection (kept for testing / future on-chain listener wiring) ───

  injectLiquidation(data: LiquidationData, blockNumber?: number): void {
    const event: FintechEvent<LiquidationData> = {
      id: uuidv4(), type: 'LIQUIDATION', source: 'LiquidLens',
      chainId: this.chainId, timestamp: Date.now(), blockNumber, data,
    };
    eventBus.publish(event);
  }

  injectMintBurn(data: MintBurnData, blockNumber?: number): void {
    const event: FintechEvent<MintBurnData> = {
      id: uuidv4(), type: data.isMint ? 'MINT' : 'BURN', source: 'LiquidLens',
      chainId: this.chainId, timestamp: Date.now(), blockNumber, data,
    };
    eventBus.publish(event);
  }

  injectWhaleTransfer(data: WhaleTransferData, blockNumber?: number): void {
    const event: FintechEvent<WhaleTransferData> = {
      id: uuidv4(), type: 'WHALE_TRANSFER', source: 'LiquidLens',
      chainId: this.chainId, timestamp: Date.now(), blockNumber, data,
    };
    eventBus.publish(event);
  }
}
