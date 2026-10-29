import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { selectWorkspaceDrivingClient } from '$store/renderer/slices/browser-clients/browser-clients-selectors';
import { resolveDrivingClientSwitch } from './driving-indicator';
import {
  PREVIEW_OWN_CLIENT_ID,
  PREVIEW_WORKSPACE_ID,
  preview,
} from './primary-client-menu.preview.svelte';

/** Run a state's store seed and read the clients the seeded menu would show. */
function seededClients(stateName: keyof typeof preview.states) {
  preview.states[stateName].setup?.();
  return selectWorkspaceDrivingClient.select(store.state, PREVIEW_WORKSPACE_ID);
}

describe('primary client menu preview', () => {
  let disposeStore: () => void = () => {};

  beforeAll(() => {
    disposeStore = store.init();
  });

  afterAll(() => {
    disposeStore();
  });

  it('registers each primary-client state with the menu open except the closed capture', () => {
    expect(preview.id).toBe('primary-client-menu');
    expect(preview.defaultState).toBe('elsewhere');
    expect(Object.keys(preview.states)).toEqual([
      'elsewhere',
      'here',
      'offline',
      'offline-closed',
      'offline-tab-host',
      'long-name',
      'no-browser',
      'guest',
      'unresolved',
    ]);
    expect(preview.states['offline-closed'].props.menuOpen).toBeUndefined();
  });

  it('seeds the store so each state resolves to its intended primary client', () => {
    expect(resolveDrivingClientSwitch(seededClients('elsewhere'))).toMatchObject({
      mode: 'elsewhere',
      hostName: 'Office Linux',
      canSwitchHere: true,
    });
    expect(resolveDrivingClientSwitch(seededClients('here'))).toMatchObject({
      mode: 'here',
      canSwitchHere: false,
    });
    expect(resolveDrivingClientSwitch(seededClients('offline'))).toMatchObject({
      mode: 'offline',
      canSwitchHere: true,
    });
    const tabHost = seededClients('offline-tab-host');
    expect(tabHost.routedVia).toBe('tabs');
    expect(tabHost.pinnedClientId).toBeNull();
    expect(resolveDrivingClientSwitch(tabHost)).toMatchObject({
      mode: 'offline',
      canSwitchHere: true,
    });
    const unresolved = seededClients('unresolved');
    expect(unresolved.driving).toBeNull();
    expect(unresolved.ownClientId).toBe(PREVIEW_OWN_CLIENT_ID);
  });
});
