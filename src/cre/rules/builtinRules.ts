import { CRERule, RuleContext } from '../types';
import { CREAlertData } from '../../types';

export const builtinRules: CRERule[] = [
  {
    id: 'peg-stress-critical',
    name: 'Critical Peg Stress',
    description: 'Fires when peg stress score exceeds 80',
    evaluate({ event }: RuleContext): CREAlertData | null {
      if (event.data.pegStress < 80) return null;
      return {
        ruleId: 'peg-stress-critical',
        ruleName: 'Critical Peg Stress',
        severity: 'CRITICAL',
        message: `Peg stress at ${event.data.pegStress}/100 — stablecoin depeg risk elevated`,
        context: { pegStress: event.data.pegStress, composite: event.data.composite },
      };
    },
  },

  {
    id: 'liquidation-cascade',
    name: 'Liquidation Cascade Warning',
    description: 'Fires when liquidation stress score exceeds 60',
    evaluate({ event }: RuleContext): CREAlertData | null {
      if (event.data.liquidationStress < 60) return null;
      return {
        ruleId: 'liquidation-cascade',
        ruleName: 'Liquidation Cascade Warning',
        severity: 'HIGH',
        message: `Liquidation stress at ${event.data.liquidationStress}/100 — cascade risk`,
        context: { liquidationStress: event.data.liquidationStress },
      };
    },
  },

  {
    id: 'composite-systemic-risk',
    name: 'Systemic Risk Threshold',
    description: 'Fires when composite risk score exceeds 70',
    evaluate({ event }: RuleContext): CREAlertData | null {
      if (event.data.composite < 70) return null;
      return {
        ruleId: 'composite-systemic-risk',
        ruleName: 'Systemic Risk Threshold',
        severity: 'CRITICAL',
        message: `Composite systemic risk score: ${event.data.composite}/100`,
        context: {
          pegStress: event.data.pegStress,
          liquidationStress: event.data.liquidationStress,
          flowPressure: event.data.flowPressure,
          composite: event.data.composite,
        },
      };
    },
  },

  {
    id: 'flow-pressure-high',
    name: 'High Flow Pressure',
    description: 'Fires when net outflow pressure exceeds 50',
    evaluate({ event }: RuleContext): CREAlertData | null {
      if (event.data.flowPressure < 50) return null;
      return {
        ruleId: 'flow-pressure-high',
        ruleName: 'High Flow Pressure',
        severity: 'MEDIUM',
        message: `Flow pressure at ${event.data.flowPressure}/100 — significant net outflows`,
        context: { flowPressure: event.data.flowPressure },
      };
    },
  },
];
