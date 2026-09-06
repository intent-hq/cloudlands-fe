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

  it('provides realistic setup fixtures and explicit absent counterparts', () => {
    const byId = Object.fromEntries(
      NEW_WORKSPACE_SCENARIOS.map((scenario) => [scenario.id, scenario]),
    );
    expect(byId['setup-empty'].fixtures.setup.recentRepos).toEqual([]);
    expect(byId['setup-empty'].fixtures.setup.github.connected).toBe(false);
    expect(byId['setup-suggestions'].fixtures.setup.recentRepos).toHaveLength(2);
    expect(byId['setup-suggestions'].fixtures.setup.github.issues).toHaveLength(1);
    expect(byId['setup-suggestions'].fixtures.setup.branches.branches).toContain('main');
    expect(byId['setup-suggestions'].fixtures.setup.providerAvailability.hasAnyProvider).toBe(true);
    expect(byId['setup-options-open'].fixtures.draft.config.isTeamMode).toBeUndefined();
    expect(byId['setup-options-modified'].fixtures.draft.config.isTeamMode).toBe(false);
    expect(byId['setup-branch-fetch-failure'].fixtures.setup.branchError).toBe(
      'Network branch fixture failure',
    );
    expect(byId['setup-readiness-missing'].fixtures.setup.providerAvailability.hasAnyProvider).toBe(
      false,
    );
  });
});
