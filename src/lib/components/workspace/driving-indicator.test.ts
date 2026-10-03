import { describe, expect, it } from 'vitest';
import { resolveDrivingClientSwitch, resolveDrivingClientView } from './driving-indicator';
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
  it('hides an idle offline pin', () => {
    expect(
      resolveDrivingClientView({
        ...input,
        driving: { clientId: 'old', connected: false },
        hasBrowserTabs: false,
      }),
    ).toBeNull();
  });
  it('shows the actual active computer with a single client and no browser tabs', () => {
    expect(
      resolveDrivingClientView({
        ...input,
        hasBrowserTabs: false,
        activeComputerName: 'Controlled MacBook',
      }),
    ).toMatchObject({ hostName: 'Controlled MacBook' });
  });
  it('shows agent-owned tabs even with only one client', () => {
    expect(resolveDrivingClientView({ ...input, hasBrowserTabs: true })).toMatchObject({
      hostName: own.name,
    });
  });
});
