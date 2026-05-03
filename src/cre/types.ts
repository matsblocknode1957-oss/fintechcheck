import { FintechEvent, RiskSnapshotData, CREAlertData } from '../types';

export interface RuleContext {
  event: FintechEvent<RiskSnapshotData>;
}

export interface CRERule {
  id: string;
  name: string;
  description: string;
  evaluate(ctx: RuleContext): CREAlertData | null;
}
