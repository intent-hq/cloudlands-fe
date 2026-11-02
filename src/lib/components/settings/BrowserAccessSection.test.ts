/**
 * @vitest-environment jsdom
 *
 * Browser access is experimental: the Mobile section, including its warning,
 * stays hidden until the browser-access feature code is active (Cmd+K).
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '$store/renderer/store';
import { setActiveFeatures } from '$store/renderer/slices/feature-codes/feature-codes-slice';
import { BROWSER_ACCESS_FEATURE_ID } from '$shared/types/browser-access';

import BrowserAccessSection from './BrowserAccessSection.svelte';

let stopStore: (() => void) | undefined;

beforeEach(() => {
  window.electronAPI = {
    ...window.electronAPI,
    invoke: vi.fn(async () => ({
      available: true,
      enabled: false,
      port: 47120,
      running: false,
      error: null,
      accessKey: 'k'.repeat(43),
    })),
    on: vi.fn(() => 'id'),
    offById: vi.fn(),
  } as never;
  stopStore = store.init();
});

afterEach(() => {
  cleanup();
  stopStore?.();
});

describe('BrowserAccessSection', () => {
  it('stays hidden while the feature code is not active', () => {
    store.dispatch(setActiveFeatures([]));
    render(BrowserAccessSection);
    expect(screen.queryByTestId('browser-access-warning')).toBeNull();
  });

  it('shows the warning and settings once the feature code is active', async () => {
    store.dispatch(setActiveFeatures([BROWSER_ACCESS_FEATURE_ID]));
    render(BrowserAccessSection);
    expect(await screen.findByTestId('browser-access-warning')).toBeTruthy();
  });
});
