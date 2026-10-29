import { describe, expect, it } from 'vitest';
import { resolveDrivingClientSwitch } from './driving-indicator';
const own = { clientId: 'own', name: 'Windows workstation', connected: true };
const input = { eligibleClients: [own], ownClientId: 'own', driving: own, pinnedClientId: null };
describe('workspace primary client', () => {
  it('allows explicitly selecting the only client even when it is the fallback', () => {
    expect(resolveDrivingClientSwitch(input)?.canSwitchHere).toBe(true);
  });
  it('represents an already selected client without hiding its menu state', () => {
    expect(resolveDrivingClientSwitch({ ...input, pinnedClientId: 'own' })).toMatchObject({
      canSwitchHere: false,
    });
  });
  it('allows selection with no resolved fallback', () => {
    expect(resolveDrivingClientSwitch({ ...input, driving: null })?.canSwitchHere).toBe(true);
  });
  it('disables selection while this client is unavailable', () => {
    expect(resolveDrivingClientSwitch({ ...input, eligibleClients: [] })?.canSwitchHere).toBe(
      false,
    );
  });
  it('reports an offline pin for recovery', () => {
    expect(
      resolveDrivingClientSwitch({ ...input, driving: { clientId: 'old', connected: false } }),
    ).toMatchObject({ mode: 'offline', canSwitchHere: true });
  });
});
