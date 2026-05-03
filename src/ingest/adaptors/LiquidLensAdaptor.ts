import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, LiquidationData, MintBurnData, WhaleTransferData } from '../../types';
import { eventBus } from '../../bus/EventBus';

/**
 * LiquidLens adaptor — ingests on-chain liquidation, mint/burn, and whale transfer events.
 * In production: replace injectXxx() with ethers.js contract event listeners
 * or a Graph Protocol subscription.
 */
export class LiquidLensAdaptor {
  private readonly chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  start(): void {
    console.log(`[LiquidLens] Listening on chainId=${this.chainId}`);
    // Wire up real on-chain event listeners here
  }

  // Called by on-chain listener when a liquidation occurs
  injectLiquidation(data: LiquidationData, blockNumber?: number): void {
    const event: FintechEvent<LiquidationData> = {
      id: uuidv4(),
      type: 'LIQUIDATION',
      source: 'LiquidLens',
      chainId: this.chainId,
      timestamp: Date.now(),
      blockNumber,
      data,
    };
    eventBus.publish(event);
  }

  injectMintBurn(data: MintBurnData, blockNumber?: number): void {
    const event: FintechEvent<MintBurnData> = {
      id: uuidv4(),
      type: data.isMint ? 'MINT' : 'BURN',
      source: 'LiquidLens',
      chainId: this.chainId,
      timestamp: Date.now(),
      blockNumber,
      data,
    };
    eventBus.publish(event);
  }

  injectWhaleTransfer(data: WhaleTransferData, blockNumber?: number): void {
    const event: FintechEvent<WhaleTransferData> = {
      id: uuidv4(),
      type: 'WHALE_TRANSFER',
      source: 'LiquidLens',
      chainId: this.chainId,
      timestamp: Date.now(),
      blockNumber,
      data,
    };
    eventBus.publish(event);
  }
}
