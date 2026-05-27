import { FintechEvent, RiskSnapshotData, CREAlertData } from '../types';

export interface RuleContext {
  event: FintechEvent<RiskSnapshotData>;
}

export interface CRERule {
  id: string;
  name: string;
  description: string;
  cooldownMs?: number;   // overrides the default 60s cooldown when set
  evaluate(ctx: RuleContext): CREAlertData | null;
}
