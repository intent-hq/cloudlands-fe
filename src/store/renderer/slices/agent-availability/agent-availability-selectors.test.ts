/**
 * Provider status on an orchestrator (PROTOCOL `provider-profiles.md` →
 * "Profiles on an orchestrator"): the backend checks no CLI, so discovery
 * reports nothing installed, yet every provider can be enabled and used —
 * its machines decide whether it runs.
 */
import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import {
  withBackendDaemonMode,
  withLegacyPrincipal,
} from '../../../../test/fixtures/principal-state';
import type { StoreState } from '../../types';
import { initialState as providerSettingsInitialState } from '../provider-settings/provider-settings-slice';
import { selectAvailableEnabledProviderIds } from '../provider-settings/provider-settings-selectors';
import { selectProviderStatusMap } from './agent-availability-selectors';

const discovered = { codex: { available: false } };

function state(daemonMode?: 'orchestrator' | 'regular'): StoreState {
  const base = withLegacyPrincipal({
    providerCatalog: {
      providers: createCollection('id', [
        { id: 'codex', visible: true, canBeDisabled: true },
        { id: 'claude-code', visible: true, canBeDisabled: true },
      ]),
    },
    providerSettings: {
      ...providerSettingsInitialState,
      enabledProviders: { codex: true, 'claude-code': false },
    },
    model: { defaultProviderId: '' },
    agentAvailability: { providerStatusMap: discovered, hiddenProviders: [] },
  });
  return daemonMode ? withBackendDaemonMode(base, daemonMode) : base;
}

describe('selectProviderStatusMap', () => {
  it('reports every catalog provider as available on an orchestrator', () => {
    const orchestrator = state('orchestrator');
    expect(selectProviderStatusMap.select(orchestrator)).toEqual({
      codex: { available: true },
      'claude-code': { available: true },
    });
    // A stable reference while the catalog is unchanged.
    expect(selectProviderStatusMap.select(orchestrator)).toBe(
      selectProviderStatusMap.select({ ...orchestrator }),
    );
  });

  it.each([undefined, 'regular'] as const)(
    'passes the discovery results through on a Full daemon (%s)',
    (mode) => {
      expect(selectProviderStatusMap.select(state(mode))).toBe(discovered);
    },
  );

  it('lets agent creation use an enabled provider on an orchestrator', () => {
    expect(selectAvailableEnabledProviderIds.select(state('orchestrator'))).toEqual(['codex']);
    expect(selectAvailableEnabledProviderIds.select(state('regular'))).toEqual([]);
  });
});
