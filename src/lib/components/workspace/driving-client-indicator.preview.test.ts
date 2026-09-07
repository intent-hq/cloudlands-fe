import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { selectWorkspaceDrivingClient } from '$store/renderer/slices/browser-clients/browser-clients-selectors';
import { resolveDrivingClientView } from './driving-indicator';
import {
  PREVIEW_OWN_CLIENT_ID,
  PREVIEW_WORKSPACE_ID,
  preview,
} from './driving-client-indicator.preview.svelte';

/** Run a state's store seed and resolve what the seeded card would show. */
function seededView(stateName: keyof typeof preview.states) {
  preview.states[stateName].setup?.();
  return resolveDrivingClientView(
    selectWorkspaceDrivingClient.select(store.state, PREVIEW_WORKSPACE_ID),
  );
}

describe('driving client indicator preview', () => {
  let disposeStore: () => void = () => {};

  beforeAll(() => {
    disposeStore = store.init();
  });

  afterAll(() => {
    disposeStore();
  });

  it('registers the four review states plus the menu-open capture', () => {
    expect(preview.id).toBe('driving-client-indicator');
    expect(preview.defaultState).toBe('driving-elsewhere');
    expect(Object.keys(preview.states)).toEqual([
      'single-client',
      'driving-here',
      'driving-elsewhere',
      'driving-elsewhere-menu-open',
      'pinned-offline',
    ]);
    expect(preview.states['driving-elsewhere-menu-open'].props.menuOpen).toBe(true);
  });

  it('seeds the store so each state resolves to its intended indicator', () => {
    expect(seededView('single-client')).toBeNull();
    expect(seededView('driving-here')).toMatchObject({ mode: 'here', canSwitchHere: false });
    expect(seededView('driving-elsewhere')).toMatchObject({
      mode: 'elsewhere',
      canSwitchHere: true,
    });
    expect(seededView('pinned-offline')).toMatchObject({ mode: 'offline', canSwitchHere: true });
    expect(selectWorkspaceDrivingClient.select(store.state, PREVIEW_WORKSPACE_ID).ownClientId).toBe(
      PREVIEW_OWN_CLIENT_ID,
    );
  });
});
