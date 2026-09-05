import { describe, expect, it } from 'vitest';
import { CONTROLLER_PHASES } from '../controller';
import {
  NEW_WORKSPACE_SCENARIOS,
  REQUIRED_SCENARIO_IDS,
  SCENARIO_FAMILIES,
  validateScenarioRegistry,
} from './scenarios';

describe('new workspace sandbox scenarios', () => {
  it('has unique ids and valid registry metadata', () => {
    expect(validateScenarioRegistry(NEW_WORKSPACE_SCENARIOS)).toEqual([]);
    expect(new Set(NEW_WORKSPACE_SCENARIOS.map((scenario) => scenario.id)).size).toBe(
      NEW_WORKSPACE_SCENARIOS.length,
    );
  });

  it.each(SCENARIO_FAMILIES)('includes the %s family', (family) => {
    expect(NEW_WORKSPACE_SCENARIOS.some((scenario) => scenario.family === family)).toBe(true);
  });

  it('contains every required named scenario', () => {
    expect(new Set(NEW_WORKSPACE_SCENARIOS.map((scenario) => scenario.id))).toEqual(
      new Set(REQUIRED_SCENARIO_IDS),
    );
  });

  it.each(CONTROLLER_PHASES)('covers the %s controller phase', (phase) => {
    expect(
      NEW_WORKSPACE_SCENARIOS.some((scenario) => scenario.initialControllerState.phase === phase),
    ).toBe(true);
  });

  it('assigns every viewport contract and reserves percentages for clone progress', () => {
    expect(new Set(NEW_WORKSPACE_SCENARIOS.map((scenario) => scenario.contract.width))).toEqual(
      new Set([360, 768, 1280]),
    );
    expect(
      NEW_WORKSPACE_SCENARIOS.filter((scenario) => scenario.contract.allowsClonePercent).map(
        (scenario) => scenario.id,
      ),
    ).toEqual(['transaction-clone-progress']);
  });
});
