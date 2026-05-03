import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, PoRAttestationData } from '../../types';
import { eventBus } from '../../bus/EventBus';

export interface PoRFeedConfig {
  asset: string;
  reserveAddress: string;
  chainId: number;
  fetchAttestation: () => Promise<{
    reportedReserves: bigint;
    circulatingSupply: bigint;
  }>;
}

/**
 * Chainlink Proof-of-Reserves adaptor.
 * In production: call Chainlink PoR aggregator contracts via ethers.js.
 */
export class ChainlinkPoRAdaptor {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private feeds: PoRFeedConfig[],
    private intervalMs = 60_000,   // PoR attests less frequently than prices
  ) {}

  start(): void {
    for (const feed of this.feeds) {
      const timer = setInterval(() => this.poll(feed), this.intervalMs);
      this.timers.push(timer);
      this.poll(feed).catch(console.error);
    }
    console.log(`[ChainlinkPoR] Started ${this.feeds.length} PoR feed(s)`);
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  private async poll(feed: PoRFeedConfig): Promise<void> {
    try {
      const { reportedReserves, circulatingSupply } = await feed.fetchAttestation();
      const collateralizationRatio =
        circulatingSupply > 0n
          ? Number(reportedReserves) / Number(circulatingSupply)
          : 0;

      const event: FintechEvent<PoRAttestationData> = {
        id: uuidv4(),
        type: 'POR_ATTESTATION',
        source: 'ChainlinkPoR',
        chainId: feed.chainId,
        timestamp: Date.now(),
        data: {
          asset: feed.asset,
          reserveAddress: feed.reserveAddress,
          reportedReserves,
          circulatingSupply,
          collateralizationRatio,
        },
      };
      eventBus.publish(event);
    } catch (err) {
      console.error(`[ChainlinkPoR] Failed to poll ${feed.asset}:`, err);
    }
  }
}
