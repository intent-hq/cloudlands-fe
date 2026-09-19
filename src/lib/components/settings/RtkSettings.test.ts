/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: { current: {} as Record<string, unknown> },
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => mocks.state.current, dispatch: mocks.dispatch });
});

import {
  checkRtkRequested,
  initializeRtkSettings,
  installRtkRequested,
  updateRtkEnabledRequested,
} from '$store/renderer/slices/host-requirements/host-requirements-slice';
import RtkSettings from './RtkSettings.svelte';

const hostRequirements = (available: boolean, enabled = false) => ({
  rtk: { checked: true, available },
  rtkEnabled: enabled,
  rtkSettingsLoaded: true,
  rtkChecking: false,
  rtkUpdating: false,
  rtkError: null,
});

describe('RtkSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.current = { hostRequirements: hostRequirements(true) };
  });

  afterEach(cleanup);

  it('dispatches initialization on mount and setting intent on toggle', async () => {
    render(RtkSettings);
    expect(mocks.dispatch).toHaveBeenCalledWith(initializeRtkSettings());

    await fireEvent.click(screen.getByRole('switch', { name: /rtk/i }));
    expect(mocks.dispatch).toHaveBeenCalledWith(updateRtkEnabledRequested(true));
  });

  it('renders unavailable state and dispatches probe and install intent', async () => {
    mocks.state.current = { hostRequirements: hostRequirements(false) };
    render(RtkSettings);

    const buttons = screen.getAllByRole('button');
    const checkButton = buttons.find((button) => button.textContent?.includes('Check'));
    const installButton = buttons.find((button) =>
      button.textContent?.includes('brew install rtk'),
    );
    expect(checkButton).toBeDefined();
    expect(installButton).toBeDefined();
    await fireEvent.click(checkButton!);
    await fireEvent.click(installButton!);
    expect(mocks.dispatch).toHaveBeenCalledWith(checkRtkRequested());
    expect(mocks.dispatch).toHaveBeenCalledWith(installRtkRequested());
  });

  it('disables setting changes while an update is in flight', () => {
    mocks.state.current = {
      hostRequirements: { ...hostRequirements(true), rtkUpdating: true },
    };
    render(RtkSettings);
    expect(screen.getByRole('switch', { name: /rtk/i }).hasAttribute('disabled')).toBe(true);
  });
});
