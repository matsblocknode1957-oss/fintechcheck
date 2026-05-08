import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, PriceUpdateData } from '../../types';
import { eventBus } from '../../bus/EventBus';

const API_URL = 'https://pegcheck.uk/api/v1/coins';

interface PegCheckCoin {
  slug: string;
  price: number;
  deviation: number;    // % distance from peg, e.g. -0.0156 means -0.0156%
  status: string;       // "stable" | "watch" | "alert"
  updated_at: string;   // ISO 8601
  chainlink_por: { reserves: number; updated_at: string } | null;
}

interface PegCheckResponse {
  coins: PegCheckCoin[];
  total: number;
}

const STATUS_CONFIDENCE: Record<string, number> = {
  stable: 0.99,
  watch:  0.80,
  alert:  0.50,
};

export class PegCheckAdaptor {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly apiKey: string,
    private readonly chainId: number,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    this.poll().catch((err) => console.error('[PegCheck] Initial poll failed:', err));
    this.timer = setInterval(
      () => this.poll().catch((err) => console.error('[PegCheck] Poll failed:', err)),
      this.intervalMs,
    );
    console.log(`[PegCheck] Polling ${API_URL} every ${this.intervalMs / 1000}s`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    const res = await fetch(API_URL, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });

    if (!res.ok) {
      console.error(`[PegCheck] HTTP ${res.status} ${res.statusText}`);
      return;
    }

    const body = (await res.json()) as PegCheckResponse;

    for (const coin of body.coins) {
      const event: FintechEvent<PriceUpdateData> = {
        id: uuidv4(),
        type: 'PRICE_UPDATE',
        source: 'PegCheck',
        chainId: this.chainId,
        timestamp: new Date(coin.updated_at).getTime(),
        data: {
          asset:     coin.slug.toUpperCase(),
          priceFeed: `pegcheck.uk/${coin.slug}`,
          price:     coin.price,
          confidence: STATUS_CONFIDENCE[coin.status] ?? 0.50,
        },
      };
      eventBus.publish(event);
    }

    console.log(`[PegCheck] Ingested ${body.coins.length} coin(s)`);
  }
}
