import { describe, expect, it } from 'vitest';
import { withLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import { initialState as workspace } from '../workspace/workspace-slice';
import { initialState as setupPrompt } from './setup-prompt-slice';
import { selectBackendSetupGate, selectShowRemoteSetupPrompt } from './setup-prompt-selectors';

describe('member empty-host setup', () => {
  it('keeps host execution setup local to the affected operation', () => {
    const state = withLegacyPrincipal({
      workspace: { ...workspace, hasLoaded: true },
      setupPrompt: {
        ...setupPrompt,
        evaluation: { connectionId: 'shared-host', isLocal: false, setupNeeded: true },
      },
      connections: { windowBackendId: 'shared-host' },
      agentAvailability: { providerStatusMap: {} },
    });
    state.principal.snapshot!.principal.hostRole = 'member';
    state.principal.snapshot!.principal.isAdministrator = false;
    state.principal.snapshot!.capabilities.hostMembership = true;
    expect(selectBackendSetupGate.select(state)).toBe('none');
    expect(selectShowRemoteSetupPrompt.select(state)).toBe(false);
  });
});
