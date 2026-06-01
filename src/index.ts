// v0.1.6 — live EUR/USD rate for EURC peg via CoinGecko, refreshed every 4h
import { InMemoryStateStore } from './state/StateStore';
import { eventBus } from './bus/EventBus';
import { PriceProcessor } from './processors/PriceProcessor';
import { LiquidationProcessor } from './processors/LiquidationProcessor';
import { PoRProcessor } from './processors/PoRProcessor';
import { PegCheckAdaptor } from './ingest/adaptors/PegCheckAdaptor';
import { ChainlinkPoRAdaptor } from './ingest/adaptors/ChainlinkPoRAdaptor';
import { LiquidLensAdaptor } from './ingest/adaptors/LiquidLensAdaptor';
import { RiskEngine } from './risk/RiskEngine';
import { RuleEngine } from './cre/RuleEngine';
import { createServer } from './api/server';
import { startEurUsdRefresh, stopEurUsdRefresh } from './utils/eurUsdRate';

const PORT = Number(process.env.PORT ?? 8080);
const CHAIN_ID = 1;  // Ethereum mainnet

// ── Chainlink PoR config ──────────────────────────────────────────────────────
// Set USDC_POR_FEED to the aggregator address from https://data.chain.link/proof-of-reserve
const USDC_POR_FEED = process.env.USDC_POR_FEED;
const USDC_TOKEN    = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const ETH_RPC_URL   = process.env.ETH_RPC_URL ?? 'https://ethereum.publicnode.com';

async function main(): Promise<void> {
  console.log('=== FintechCheck starting ===');

  // 0. Fetch live EUR/USD rate before any price events are processed
  await startEurUsdRefresh();

  // 1. State
  const store = new InMemoryStateStore();

  // 2. Processors (subscribe to bus before adaptors start producing)
  new PriceProcessor(store).start();
  new LiquidationProcessor(store).start();
  new PoRProcessor(store).start();

  // 3. Risk + CRE (subscribe before adaptors produce events)
  const riskEngine = new RiskEngine(store, CHAIN_ID);
  const ruleEngine = new RuleEngine(CHAIN_ID);
  riskEngine.start();
  ruleEngine.start();

  // 4. Ingestion adaptors
  const pegCheck = new PegCheckAdaptor(
    process.env.PEGCHECK_API_KEY ?? 'pk_live_test123',
    CHAIN_ID,
    30_000,
  );

  const porAdaptor = new ChainlinkPoRAdaptor(
    [
      {
        asset: 'USDC',
        // Chainlink PoR aggregator address (set USDC_POR_FEED env var)
        reserveAddress: USDC_POR_FEED ?? 'unconfigured',
        chainId: CHAIN_ID,
        fetchAttestation: fetchUsdcPoR,
      },
    ],
    30_000,
  );

  const liquidLens = new LiquidLensAdaptor(CHAIN_ID);

  pegCheck.start();
  porAdaptor.start();
  liquidLens.start();

  // 5. API
  const app = createServer(store, ruleEngine);
  app.listen(PORT, () => {
    console.log(`[API] Listening on http://localhost:${PORT}/api`);
    console.log(`  GET /api/health`);
    console.log(`  GET /api/risk`);
    console.log(`  GET /api/prices`);
    console.log(`  GET /api/alerts`);
    console.log(`  GET /api/state`);
  });

  // 7. Global alert logger
  eventBus.subscribe('CRE_ALERT', (event) => {
    const d = (event as { data: { severity: string; ruleName: string; message: string } }).data;
    console.log(`\n  *** ALERT [${d.severity}] ${d.ruleName}\n      ${d.message}\n`);
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopEurUsdRefresh();
    pegCheck.stop();
    porAdaptor.stop();
    liquidLens.stop();
    riskEngine.stop();
    process.exit(0);
  });
}

// ─── Chainlink PoR fetcher ────────────────────────────────────────────────────

async function fetchUsdcPoR(): Promise<{ reportedReserves: bigint; circulatingSupply: bigint }> {
  if (!USDC_POR_FEED) {
    throw new Error(
      'USDC_POR_FEED env var not set — find the aggregator address at https://data.chain.link/proof-of-reserve',
    );
  }

  const call = async (to: string, data: string): Promise<string> => {
    const res = await fetch(ETH_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    const json = await res.json() as { result?: string };
    if (!json.result || json.result === '0x') throw new Error(`eth_call to ${to} returned empty`);
    return json.result;
  };

  const [roundHex, supplyHex] = await Promise.all([
    // latestRoundData() = 0xfeaf968c
    // returns: roundId (32B) | answer (32B) | startedAt | updatedAt | answeredInRound
    call(USDC_POR_FEED, '0xfeaf968c'),
    // totalSupply() = 0x18160ddd
    call(USDC_TOKEN, '0x18160ddd'),
  ]);

  // answer is the second 32-byte slot (offset 64 hex chars after '0x')
  const answerHex = roundHex.slice(2 + 64, 2 + 128);
  // PoR answer has 8 decimals; USDC totalSupply has 6 — divide by 100 to match scale
  const reportedReserves = BigInt('0x' + answerHex) / 100n;
  const circulatingSupply = BigInt(supplyHex);
  return { reportedReserves, circulatingSupply };
}


main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
