// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import { selectReduceMotionOnBattery } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
import { setReduceMotionOnBattery } from '$store/renderer/slices/user-preferences/user-preferences-slice';
import ReduceMotionOnBatterySettings from './ReduceMotionOnBatterySettings.svelte';

let dispose: () => void;
beforeEach(() => {
  dispose = appStore.init();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dispose();
});

describe('ReduceMotionOnBatterySettings', () => {
  it.each([false, true])('dispatches the opposite preference from %s', async (enabled) => {
    appStore.dispatch(setReduceMotionOnBattery(enabled));
    const dispatch = vi.spyOn(appStore, 'dispatch');
    render(ReduceMotionOnBatterySettings);
    const toggle = screen.getByRole('switch');
    const label = document.getElementById(toggle.getAttribute('aria-labelledby')!);
    const description = document.getElementById(toggle.getAttribute('aria-describedby')!);
    expect(label?.textContent?.trim()).toBeTruthy();
    expect(description?.textContent?.trim()).toBeTruthy();
    await fireEvent.click(toggle);
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'userPreferences/setReduceMotionOnBattery',
      payload: [!enabled],
    });
    expect(selectReduceMotionOnBattery.select(appStore.state)).toBe(!enabled);
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe(String(!enabled)));
  });
});
