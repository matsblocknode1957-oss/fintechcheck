import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, RiskSnapshotData, CREAlertData } from '../types';
import { eventBus } from '../bus/EventBus';
import { CRERule } from './types';
import { builtinRules } from './rules/builtinRules';

/**
 * CRE — Condition-Rule-Effect engine.
 * Subscribes to RISK_SNAPSHOT events, evaluates all registered rules,
 * and publishes CRE_ALERT events for each triggered rule.
 *
 * Rules are pure functions: (context) => alert | null.
 * Adding a rule = pushing to the registry. No framework needed.
 */
export class RuleEngine {
  private rules: Map<string, CRERule> = new Map();
  private alertHistory: Array<FintechEvent<CREAlertData>> = [];

  constructor(private chainId: number) {
    for (const rule of builtinRules) {
      this.register(rule);
    }
  }

  register(rule: CRERule): void {
    this.rules.set(rule.id, rule);
    console.log(`[CRE] Registered rule: ${rule.id}`);
  }

  unregister(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  start(): void {
    eventBus.subscribe<RiskSnapshotData>('RISK_SNAPSHOT', (event) => this.evaluate(event));
    console.log(`[CRE] Started with ${this.rules.size} rule(s)`);
  }

  getAlertHistory(limit = 50): Array<FintechEvent<CREAlertData>> {
    return this.alertHistory.slice(-limit);
  }

  private evaluate(event: FintechEvent<RiskSnapshotData>): void {
    const triggered: string[] = [];

    for (const rule of this.rules.values()) {
      const alert = rule.evaluate({ event });
      if (!alert) continue;

      triggered.push(rule.id);
      const alertEvent: FintechEvent<CREAlertData> = {
        id: uuidv4(),
        type: 'CRE_ALERT',
        source: event.source,
        chainId: this.chainId,
        timestamp: Date.now(),
        data: alert,
      };

      this.alertHistory.push(alertEvent);
      if (this.alertHistory.length > 500) this.alertHistory.shift();

      eventBus.publish(alertEvent);
      console.log(`[CRE] ALERT [${alert.severity}] ${alert.ruleName}: ${alert.message}`);
    }

    // Update snapshot with which rules fired
    event.data.triggeredRules = triggered;
  }
}
