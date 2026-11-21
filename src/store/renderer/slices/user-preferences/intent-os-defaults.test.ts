import { afterEach, describe, expect, it, vi } from 'vitest';

type Bridge = { intentOs?: boolean };

function bridge(): Bridge {
  return (window as unknown as { electronAPI: Bridge }).electronAPI;
}

async function freshSlice(intentOs: boolean) {
  vi.resetModules();
  bridge().intentOs = intentOs;
  return import('./user-preferences-slice');
}

describe('user preference defaults on Intent OS', () => {
  afterEach(() => {
    delete bridge().intentOs;
    vi.resetModules();
  });

  it('auto-hides the menu bar by default, and a saved off wins', async () => {
    const slice = await freshSlice(true);
    expect(slice.initialState.menuBarAutoHide).toBe(true);
    const saved = slice.userPreferencesReducer(slice.initialState, slice.setMenuBarAutoHide(false));
    expect(saved.menuBarAutoHide).toBe(false);
  });

  it('keeps the menu bar outside Intent OS', async () => {
    const slice = await freshSlice(false);
    expect(slice.initialState.menuBarAutoHide).toBe(false);
  });
});
