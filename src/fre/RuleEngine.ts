import { v4 as uuidv4 } from 'uuid';
import { FintechEvent, RiskSnapshotData, FREAlertData } from '../types';
import { eventBus } from '../bus/EventBus';
import { FRERule } from './types';
import { builtinRules } from './rules/builtinRules';

/**
 * FRE — Fintech Risk Engine.
 * Subscribes to RISK_SNAPSHOT events, evaluates all registered rules,
 * and publishes FRE_ALERT events for each triggered rule.
 *
 * Rules are pure functions: (context) => alert | null.
 * Adding a rule = pushing to the registry. No framework needed.
 */
const ALERT_COOLDOWN_MS = 60_000;

export class RuleEngine {
  private rules: Map<string, FRERule> = new Map();
  private alertHistory: Array<FintechEvent<FREAlertData>> = [];
  private lastFired = new Map<string, number>();  // ruleId → last fired ms

  constructor(private chainId: number) {
    for (const rule of builtinRules) {
      this.register(rule);
    }
  }

  register(rule: FRERule): void {
    this.rules.set(rule.id, rule);
    console.log(`[FRE] Registered rule: ${rule.id}`);
  }

  unregister(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  start(): void {
    eventBus.subscribe<RiskSnapshotData>('RISK_SNAPSHOT', (event) => this.evaluate(event));
    console.log(`[FRE] Started with ${this.rules.size} rule(s)`);
  }

  getAlertHistory(limit = 50): Array<FintechEvent<FREAlertData>> {
    return this.alertHistory.slice(-limit);
  }

  private evaluate(event: FintechEvent<RiskSnapshotData>): void {
    const triggered: string[] = [];
    const now = Date.now();

    for (const rule of this.rules.values()) {
      // Skip if this rule already fired within the cooldown window.
      // The risk engine re-scores on every PEG_DEVIATION event; with 19 coins
      // per poll that generates up to 19 snapshots and 19 identical alerts.
      const lastFiredAt = this.lastFired.get(rule.id) ?? 0;
      const cooldown = rule.cooldownMs ?? ALERT_COOLDOWN_MS;
      if (now - lastFiredAt < cooldown) continue;

      const alert = rule.evaluate({ event });
      if (!alert) continue;

      this.lastFired.set(rule.id, now);
      triggered.push(rule.id);
      const alertEvent: FintechEvent<FREAlertData> = {
        id: uuidv4(),
        type: 'FRE_ALERT',
        source: event.source,
        chainId: this.chainId,
        timestamp: Date.now(),
        data: alert,
      };

      this.alertHistory.push(alertEvent);
      if (this.alertHistory.length > 500) this.alertHistory.shift();

      eventBus.publish(alertEvent);
      console.log(`[FRE] ALERT [${alert.severity}] ${alert.ruleName}: ${alert.message}`);
    }

    // Update snapshot with which rules fired
    event.data.triggeredRules = triggered;
  }
}
