import { FintechEvent, PoRAttestationData } from '../types';
import { IStateStore } from '../state/StateStore';
import { eventBus } from '../bus/EventBus';

export class PoRProcessor {
  constructor(private store: IStateStore) {}

  start(): void {
    eventBus.subscribe<PoRAttestationData>('POR_ATTESTATION', (e) => this.handle(e));
  }

  private handle(event: FintechEvent<PoRAttestationData>): void {
    const d = event.data;
    this.store.setPoR(d.asset, {
      asset: d.asset,
      collateralizationRatio: d.collateralizationRatio,
      lastUpdated: event.timestamp,
    });
  }
}
