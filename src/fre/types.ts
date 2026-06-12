import { FintechEvent, RiskSnapshotData, FREAlertData } from '../types';

export interface RuleContext {
  event: FintechEvent<RiskSnapshotData>;
}

export interface FRERule {
  id: string;
  name: string;
  description: string;
  cooldownMs?: number;   // overrides the default 60s cooldown when set
  evaluate(ctx: RuleContext): FREAlertData | null;
}
