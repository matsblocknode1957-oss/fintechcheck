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

const PORT = Number(process.env.PORT ?? 3000);
const CHAIN_ID = 1;  // Ethereum mainnet

async function main(): Promise<void> {
  console.log('=== FintechCheck starting ===');

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
        reserveAddress: '0xCircleReserve',
        chainId: CHAIN_ID,
        fetchAttestation: simulatePoR(1.02),
      },
    ],
    30_000,
  );

  const liquidLens = new LiquidLensAdaptor(CHAIN_ID);

  pegCheck.start();
  porAdaptor.start();
  liquidLens.start();

  // 5. Simulate some on-chain events for demo
  simulateOnChainEvents(liquidLens);

  // 6. API
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
    pegCheck.stop();
    porAdaptor.stop();
    riskEngine.stop();
    process.exit(0);
  });
}

// ─── Simulation helpers ───────────────────────────────────────────────────────

function simulatePoR(ratio: number): () => Promise<{ reportedReserves: bigint; circulatingSupply: bigint }> {
  return async () => ({
    reportedReserves: BigInt(Math.round(ratio * 1_000_000_000)),
    circulatingSupply: BigInt(1_000_000_000),
  });
}

function simulateOnChainEvents(lens: LiquidLensAdaptor): void {
  // Fire a simulated liquidation after 8s
  setTimeout(() => {
    lens.injectLiquidation({
      protocol: 'Aave-v3',
      borrower: '0xDeadBeef',
      collateralAsset: 'ETH',
      debtAsset: 'USDC',
      collateralSeized: 10.5,
      debtRepaid: 15_000,
      healthFactorBefore: 0.95,
    });
    console.log('[Sim] Injected liquidation event');
  }, 8_000);

  // Fire a large burn (outflow) after 15s
  setTimeout(() => {
    lens.injectMintBurn({
      protocol: 'MakerDAO',
      asset: 'DAI',
      amount: 8_000_000,
      actor: '0xWhale',
      isMint: false,
    });
    console.log('[Sim] Injected large DAI burn (outflow)');
  }, 15_000);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
