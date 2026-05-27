import { FintechEvent, PriceUpdateData, PegDeviationData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';
import { v4 as uuidv4 } from 'uuid';
import { getEurUsdRate } from '../utils/eurUsdRate';

/**
 * Processes PRICE_UPDATE events: updates state and derives PEG_DEVIATION
 * if the asset has a known peg target.
 */
const PEG_TARGETS: Record<string, number> = {
  // USD-pegged — 1.0
  DAI:    1.0,
  FRAX:   1.0,
  LUSD:   1.0,
  USDT:   1.0,
  USDC:   1.0,
  USDS:   1.0,
  USDE:   1.0,   // Ethena USDe
  ETHENA: 1.0,   // alternate slug used by some feeds
  PYUSD:  1.0,
  FDUSD:  1.0,
  RLUSD:  1.0,
  TUSD:   1.0,
  MKUSD:  1.0,   // Prisma mkUSD
  CRVUSD: 1.0,   // Curve crvUSD
  USDP:   1.0,   // Pax Dollar
  GUSD:   1.0,   // Gemini Dollar
  GHO:    1.0,   // Aave GHO
  DOLA:   1.0,   // Inverse Finance DOLA
  ALUSD:  1.0,   // Alchemix alUSD
  // EURC is EUR-pegged — peg resolved live via getEurUsdRate()
};

export class PriceProcessor {
  constructor(private store: IStateStore) {}

  start(): void {
    eventBus.subscribe<PriceUpdateData>('PRICE_UPDATE', (event) => this.handle(event));
  }

  private handle(event: FintechEvent<PriceUpdateData>): void {
    const { asset, price } = event.data;
    // event.data.peg takes precedence (adaptor sets live EUR/USD for EURC).
    // EURC fallback: live EUR/USD rate. All others: static PEG_TARGETS map.
    const peg = event.data.peg
      ?? (asset === 'EURC' ? getEurUsdRate() : PEG_TARGETS[asset])
      ?? 0;
    const deviationBps = peg > 0 ? Math.round(((price - peg) / peg) * 10_000) : 0;

    this.store.setPrice(asset, {
      asset,
      price,
      peg,
      deviationBps,
      lastUpdated: event.timestamp,
    });

    if (peg > 0 && Math.abs(deviationBps) > 0) {
      const deviationEvent: FintechEvent<PegDeviationData> = {
        id: uuidv4(),
        type: 'PEG_DEVIATION',
        source: event.source,
        chainId: event.chainId,
        timestamp: event.timestamp,
        blockNumber: event.blockNumber,
        data: { asset, peg, price, deviationBps },
      };
      eventBus.publish(deviationEvent);
    }
  }
}
