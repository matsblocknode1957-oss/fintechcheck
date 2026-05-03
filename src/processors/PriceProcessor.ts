import { FintechEvent, PriceUpdateData, PegDeviationData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';
import { v4 as uuidv4 } from 'uuid';

/**
 * Processes PRICE_UPDATE events: updates state and derives PEG_DEVIATION
 * if the asset has a known peg target.
 */
const PEG_TARGETS: Record<string, number> = {
  USDC: 1.0,
  USDT: 1.0,
  DAI: 1.0,
  FRAX: 1.0,
  LUSD: 1.0,
};

export class PriceProcessor {
  constructor(private store: IStateStore) {}

  start(): void {
    eventBus.subscribe<PriceUpdateData>('PRICE_UPDATE', (event) => this.handle(event));
  }

  private handle(event: FintechEvent<PriceUpdateData>): void {
    const { asset, price } = event.data;
    const peg = PEG_TARGETS[asset] ?? 0;
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
