import { describe, expect, it } from 'vitest';
import { NEW_WORKSPACE_SCENARIOS, SCENARIO_FAMILIES, validateScenarioRegistry } from './scenarios';

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
});
