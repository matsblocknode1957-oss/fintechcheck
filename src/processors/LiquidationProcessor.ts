import { FintechEvent, LiquidationData, MintBurnData, WhaleTransferData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';

export class LiquidationProcessor {
  constructor(private store: IStateStore) {}

  start(): void {
    eventBus.subscribe<LiquidationData>('LIQUIDATION', (e) => this.handleLiquidation(e));
    eventBus.subscribe<MintBurnData>('MINT', (e) => this.handleMintBurn(e));
    eventBus.subscribe<MintBurnData>('BURN', (e) => this.handleMintBurn(e));
    eventBus.subscribe<WhaleTransferData>('WHALE_TRANSFER', (e) => this.handleWhaleTransfer(e));
  }

  private handleLiquidation(event: FintechEvent<LiquidationData>): void {
    const d = event.data;
    this.store.addLiquidation({
      protocol: d.protocol,
      collateralAsset: d.collateralAsset,
      debtAsset: d.debtAsset,
      collateralSeized: d.collateralSeized,
      debtRepaid: d.debtRepaid,
      timestamp: event.timestamp,
    });
  }

  private handleMintBurn(event: FintechEvent<MintBurnData>): void {
    const d = event.data;
    // Mints = inflow pressure, burns = outflow pressure
    const netFlow = d.isMint ? d.amount : -d.amount;
    this.store.addFlow({
      asset: d.asset,
      netFlow,
      usdVolume: Math.abs(d.amount),
      timestamp: event.timestamp,
      transferType: d.isMint ? 'mint' : 'burn',
      blockNumber: event.blockNumber,
      txHash: d.txHash,
    });
  }

  private handleWhaleTransfer(event: FintechEvent<WhaleTransferData>): void {
    const d = event.data;
    this.store.addFlow({
      asset: d.asset,
      netFlow: 0,   // transfer is neutral for supply but tracks volume
      usdVolume: d.usdValue,
      timestamp: event.timestamp,
      transferType: 'whale',
      blockNumber: event.blockNumber,
      txHash: d.txHash,
    });
  }
}
