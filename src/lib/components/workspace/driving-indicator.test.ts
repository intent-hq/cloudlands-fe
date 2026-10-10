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
  it('shows an idle offline pin for recovery', () => {
    expect(
      resolveDrivingClientView({
        ...input,
        driving: { clientId: 'old', connected: false },
        hasBrowserTabs: false,
      }),
    ).toMatchObject({ mode: 'offline', canSwitchHere: true });
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
  it('keeps the active computer authoritative over stale offline browser routing', () => {
    const offline = {
      ...input,
      driving: { clientId: 'old', connected: false },
      hasBrowserTabs: false,
    };
    expect(
      resolveDrivingClientView({ ...offline, activeComputerName: 'Controlled MacBook' }),
    ).toMatchObject({ mode: 'elsewhere', hostName: 'Controlled MacBook' });
    expect(resolveDrivingClientView(offline)).toMatchObject({ mode: 'offline', hostName: 'old' });
  });
  it('hides a connected idle primary', () => {
    expect(resolveDrivingClientView({ ...input, hasBrowserTabs: false })).toBeNull();
  });
  it('shows agent-owned tabs even with only one client', () => {
    expect(resolveDrivingClientView({ ...input, hasBrowserTabs: true })).toMatchObject({
      hostName: own.name,
    });
  });
});
