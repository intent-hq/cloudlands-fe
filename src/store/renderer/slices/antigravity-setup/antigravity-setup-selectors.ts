import { store } from '../../store';
export const selectAntigravitySetup = store.createSelector((state) => state.antigravitySetup);

/** Only a generation change starts or supersedes setup work; a reducer-deduped repeat does not. */
export const selectAntigravitySetupRequest = store.createSelector((state) => ({
  generation: state.antigravitySetup.generation,
  command: state.antigravitySetup.command,
}));

/** Availability alone cannot override the current guided attempt's model check. */
export const selectAntigravitySetupPolicy = store.createSelector((state) => {
  const setup = state.antigravitySetup;
  const connected = setup.result?.ok && setup.result.status.phase === 'connected';
  return {
    hasAttempt: setup.attempted,
    connected: Boolean(connected && (!setup.attempted || setup.verified)),
    canEnable: !setup.attempted || Boolean(!setup.busy && connected && setup.verified),
  };
});
