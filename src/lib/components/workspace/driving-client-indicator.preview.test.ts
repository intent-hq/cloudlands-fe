import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/configured-store';
import { selectWorkspaceDrivingClient } from '$store/renderer/slices/browser-clients/browser-clients-selectors';
import { selectWorkspaceHasAgentBrowserTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import { resolveDrivingClientSwitch, resolveDrivingClientView } from './driving-indicator';
import {
  PREVIEW_OWN_CLIENT_ID,
  PREVIEW_WORKSPACE_ID,
  preview,
} from './driving-client-indicator.preview.svelte';

/** Run a state's store seed and resolve what the seeded card would show. */
function seededView(stateName: keyof typeof preview.states) {
  preview.states[stateName].setup?.();
  return resolveDrivingClientView({
    ...selectWorkspaceDrivingClient.select(store.state, PREVIEW_WORKSPACE_ID),
    hasBrowserTabs: selectWorkspaceHasAgentBrowserTabs.select(store.state, PREVIEW_WORKSPACE_ID),
  });
}

describe('driving client indicator preview', () => {
  let disposeStore: () => void = () => {};

  beforeAll(() => {
    disposeStore = store.init();
  });

  afterAll(() => {
    disposeStore();
  });

  it('registers the five review states plus the menu-open capture', () => {
    expect(preview.id).toBe('driving-client-indicator');
    expect(preview.defaultState).toBe('driving-elsewhere');
    expect(Object.keys(preview.states)).toEqual([
      'single-client',
      'driving-here',
      'driving-elsewhere',
      'driving-elsewhere-menu-open',
      'no-browser-tabs',
      'pinned-offline',
    ]);
    expect(preview.states['driving-elsewhere-menu-open'].props.menuOpen).toBe(true);
  });

  it('seeds the store so each state resolves to its intended indicator', () => {
    expect(seededView('single-client')).toMatchObject({ mode: 'here' });
    expect(seededView('driving-here')).toMatchObject({ mode: 'here', canSwitchHere: true });
    expect(seededView('driving-elsewhere')).toMatchObject({
      mode: 'elsewhere',
      canSwitchHere: true,
    });
    // Two clients but no browser tab: the indicator stays hidden while the
    // "Set Current Client as Primary" action remains offered.
    expect(seededView('no-browser-tabs')).toBeNull();
    expect(
      resolveDrivingClientSwitch(
        selectWorkspaceDrivingClient.select(store.state, PREVIEW_WORKSPACE_ID),
      ),
    ).toMatchObject({ mode: 'elsewhere', canSwitchHere: true });
    // An offline pin offers recovery even before an agent opens a tab.
    expect(seededView('pinned-offline')).toMatchObject({ mode: 'offline' });
    expect(selectWorkspaceHasAgentBrowserTabs.select(store.state, PREVIEW_WORKSPACE_ID)).toBe(
      false,
    );
    expect(selectWorkspaceDrivingClient.select(store.state, PREVIEW_WORKSPACE_ID).ownClientId).toBe(
      PREVIEW_OWN_CLIENT_ID,
    );
  });
});
