/**
 * @vitest-environment jsdom
 *
 * Browser access is experimental: the Mobile section, including its warning,
 * stays hidden until the browser-access Labs flag is on (Cmd+K).
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { store } from '$store/renderer/store';
import { setLabsBrowserAccessEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';

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
  it('stays hidden while the Labs flag is off', () => {
    store.dispatch(setLabsBrowserAccessEnabled(false));
    render(BrowserAccessSection);
    expect(screen.queryByTestId('browser-access-warning')).toBeNull();
  });

  it('shows the warning and settings once the Labs flag is on', async () => {
    store.dispatch(setLabsBrowserAccessEnabled(true));
    render(BrowserAccessSection);
    expect(await screen.findByTestId('browser-access-warning')).toBeTruthy();
  });
});
