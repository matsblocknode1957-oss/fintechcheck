import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, PriceUpdateData } from '../../types';
import { eventBus } from '../../bus/EventBus';

/**
 * PegCheck adaptor — ingests multi-source price feeds.
 * In production: replace the polling interval with WebSocket subscriptions
 * to Pyth, Chainlink price feeds, or a DEX TWAP oracle.
 */
export interface PriceFeedConfig {
  asset: string;
  priceFeed: string;
  chainId: number;
  fetchPrice: () => Promise<number>;
}

export class PegCheckAdaptor {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private feeds: PriceFeedConfig[],
    private intervalMs = 5_000,
  ) {}

  start(): void {
    for (const feed of this.feeds) {
      const timer = setInterval(() => this.poll(feed), this.intervalMs);
      this.timers.push(timer);
      // Immediate first tick
      this.poll(feed).catch(console.error);
    }
    console.log(`[PegCheck] Started ${this.feeds.length} price feed(s)`);
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private async poll(feed: PriceFeedConfig): Promise<void> {
    try {
      const price = await feed.fetchPrice();
      const event: FintechEvent<PriceUpdateData> = {
        id: uuidv4(),
        type: 'PRICE_UPDATE',
        source: 'PegCheck',
        chainId: feed.chainId,
        timestamp: Date.now(),
        data: { asset: feed.asset, priceFeed: feed.priceFeed, price },
      };
      eventBus.publish(event);
    } catch (err) {
      console.error(`[PegCheck] Failed to poll ${feed.asset}:`, err);
    }
  }
}
