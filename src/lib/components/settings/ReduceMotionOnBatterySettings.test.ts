// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enabled: false,
  dispatch: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ userPreferences: { reduceMotionOnBattery: mocks.enabled } }),
    dispatch: mocks.dispatch,
  });
});

import ReduceMotionOnBatterySettings from './ReduceMotionOnBatterySettings.svelte';

afterEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
  mocks.enabled = false;
});

describe('ReduceMotionOnBatterySettings', () => {
  it.each([false, true])('dispatches the opposite preference from %s', async (enabled) => {
    mocks.enabled = enabled;
    render(ReduceMotionOnBatterySettings);
    const toggle = screen.getByRole('switch');
    const label = document.getElementById(toggle.getAttribute('aria-labelledby')!);
    const description = document.getElementById(toggle.getAttribute('aria-describedby')!);
    expect(label?.textContent?.trim()).toBeTruthy();
    expect(description?.textContent?.trim()).toBeTruthy();
    await fireEvent.click(toggle);
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({
      type: 'userPreferences/setReduceMotionOnBattery',
      payload: [!enabled],
    });
    expect(toggle.getAttribute('aria-checked')).toBe(String(!enabled));
  });
});
