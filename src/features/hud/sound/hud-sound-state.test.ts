import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Persistence goes through safeLocalStorage; mock it so the tests control the
// persisted-read path and can assert writes without real storage semantics.
const getItemMock = vi.fn<(key: string) => string | null>(() => null);
const setItemMock = vi.fn<(key: string, value: string) => void>();

vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: {
    getItem: (key: string) => getItemMock(key),
    setItem: (key: string, value: string) => setItemMock(key, value),
  },
}));

/** Fresh module per test so the initial localStorage read is exercised. */
async function loadState() {
  vi.resetModules();
  return await import('./hud-sound-state');
}

describe('hud-sound-state', () => {
  beforeEach(() => {
    getItemMock.mockReset().mockReturnValue(null);
    setItemMock.mockReset();
  });

  it('defaults OFF when nothing is persisted', async () => {
    const state = await loadState();
    expect(state.isHudSoundEnabled()).toBe(false);
    expect(get(state.hudSoundEnabled)).toBe(false);
    expect(getItemMock).toHaveBeenCalledWith(state.HUD_SOUND_ENABLED_STORAGE_KEY);
  });

  it('restores a persisted ON state', async () => {
    getItemMock.mockReturnValue('true');
    const state = await loadState();
    expect(state.isHudSoundEnabled()).toBe(true);
    expect(get(state.hudSoundEnabled)).toBe(true);
  });

  it('treats non-"true" persisted values as OFF', async () => {
    getItemMock.mockReturnValue('yes');
    const state = await loadState();
    expect(state.isHudSoundEnabled()).toBe(false);
  });

  it('setHudSoundEnabled updates the readable, sync read and storage', async () => {
    const state = await loadState();
    const seen: boolean[] = [];
    const unsubscribe = state.hudSoundEnabled.subscribe((value) => seen.push(value));

    state.setHudSoundEnabled(true);
    expect(state.isHudSoundEnabled()).toBe(true);
    expect(setItemMock).toHaveBeenCalledWith(state.HUD_SOUND_ENABLED_STORAGE_KEY, 'true');

    state.setHudSoundEnabled(false);
    expect(state.isHudSoundEnabled()).toBe(false);
    expect(setItemMock).toHaveBeenCalledWith(state.HUD_SOUND_ENABLED_STORAGE_KEY, 'false');

    expect(seen).toEqual([false, true, false]);
    unsubscribe();
  });

  it('toggleHudSoundEnabled flips and returns the new value', async () => {
    const state = await loadState();
    expect(state.toggleHudSoundEnabled()).toBe(true);
    expect(state.isHudSoundEnabled()).toBe(true);
    expect(state.toggleHudSoundEnabled()).toBe(false);
    expect(state.isHudSoundEnabled()).toBe(false);
  });
});
