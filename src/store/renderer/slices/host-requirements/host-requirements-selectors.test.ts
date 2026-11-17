/**
 * The onboarding requirements gate. An orchestrator runs no providers, so it
 * never needs Node.js: only git gates it (machine-facts.ts, PROTOCOL
 * `methods/nodes.md` → "Orchestrator mode").
 */
import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import {
  withBackendDaemonMode,
  withLegacyPrincipal,
} from '../../../../test/fixtures/principal-state';
import { selectAllRequirementsMet, selectNodeRequired } from './host-requirements-selectors';

function state(
  { git, node }: { git: boolean; node: boolean },
  daemonMode?: 'orchestrator' | 'regular',
): StoreState {
  const base = withLegacyPrincipal({
    hostRequirements: {
      git: { checked: true, available: git },
      node: { checked: true, ok: node },
      gh: { checked: true, available: false },
      checking: false,
      hasCheckedOnce: true,
    },
  });
  return daemonMode ? withBackendDaemonMode(base, daemonMode) : base;
}

describe('selectAllRequirementsMet', () => {
  it.each([undefined, 'regular'] as const)(
    'needs git and Node.js on a Full daemon (%s)',
    (mode) => {
      expect(selectAllRequirementsMet.select(state({ git: true, node: false }, mode))).toBe(false);
      expect(selectAllRequirementsMet.select(state({ git: true, node: true }, mode))).toBe(true);
      expect(selectNodeRequired.select(state({ git: true, node: true }, mode))).toBe(true);
    },
  );

  it('needs git only on an orchestrator', () => {
    const orchestrator = state({ git: true, node: false }, 'orchestrator');
    expect(selectAllRequirementsMet.select(orchestrator)).toBe(true);
    expect(selectNodeRequired.select(orchestrator)).toBe(false);
    expect(selectAllRequirementsMet.select(state({ git: false, node: true }, 'orchestrator'))).toBe(
      false,
    );
  });
});
