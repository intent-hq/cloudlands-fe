/**
 * @vitest-environment jsdom
 *
 * ProviderCard explicit-refresh feedback: clicking the per-card refresh
 * button must show "Checking…" + a spinning icon until the single-provider
 * probe settles — even though AgentGrid suppresses `statusLoading` once a
 * status is cached. Background rechecks (loading flips without a click) must
 * stay silent: no "Checking…" flicker.
 *
 * Uses the REAL store (reducer + provider-availability middleware) and the
 * mock IPC router so the test asserts the exact `providers:check-single`
 * wire request and feeds back a contract-shaped response.
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/svelte';
import { registerMockIpcHandler, unregisterMockIpcHandler } from '$shared/ipc-mock-router';

// Quiet unrelated boot middlewares (settings hydration, daemon events bridge).
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: 'sub-card-refresh-1' }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

// REAL electron-bridge (test-setup stubs it globally): its invoke() routes
// through the mock IPC router, so registerMockIpcHandler sees the wire call.
vi.mock('$lib/electron-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/electron-bridge')>();
  return { ...actual };
});

import { store as appStore } from '$store/renderer/store';
import {
  checkSingleProviderSuccess,
  setAllProvidersLoading,
} from '$store/renderer/slices/agent-availability/agent-availability-slice';
import ProviderCard from './ProviderCard.svelte';
import type { ProviderCardData, ProviderBrandColors } from './ProviderCard.svelte';

const CHECK_SINGLE = 'providers:check-single';
const brand: ProviderBrandColors = { color1: '#8B8BF8cc', color2: '#8B8BF8' };

const notInstalledProvider = (): ProviderCardData => ({
  id: 'opencode',
  name: 'OpenCode',
  available: false,
  authenticated: undefined,
  statusLoading: false,
  authDetails: undefined,
  docsUrl: 'https://opencode.ai/docs',
  installCommand: 'npm install -g opencode-ai',
  loginCommand: 'opencode auth login',
  description: '',
  hasNpxFallback: false,
});

const baseProps = () => ({
  brand,
  npxStatus: null,
  auggieNeedsUpdate: false,
  onSelect: vi.fn(),
});

const refreshButton = (root: HTMLElement) =>
  root.querySelector('[aria-label="Refresh OpenCode status"]') as HTMLElement;
const statusText = (root: HTMLElement) => root.textContent ?? '';
const spinner = (root: HTMLElement) => refreshButton(root)?.querySelector('span.inline-block');

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe('ProviderCard explicit refresh feedback', () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
  });

  afterEach(() => {
    unregisterMockIpcHandler(CHECK_SINGLE);
  });

  it('shows Checking… and spins the icon from click until the probe settles', async () => {
    let releaseProbe: () => void = () => {};
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const checkSingle = vi.fn(async (providerId: string) => {
      await probeGate;
      return { success: true, providerId, data: { available: false } };
    });
    registerMockIpcHandler(CHECK_SINGLE, checkSingle);

    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: notInstalledProvider() },
    });

    // Cached status rendered — statusLoading is false, no Checking… yet.
    expect(statusText(container)).toContain('Not installed');
    expect(statusText(container)).not.toContain('Checking…');

    await fireEvent.click(refreshButton(container));

    // Exact wire request: providers:check-single with the provider id.
    expect(checkSingle).toHaveBeenCalledTimes(1);
    expect(checkSingle).toHaveBeenCalledWith('opencode');

    // Feedback is immediate even though the card has a cached status.
    await waitFor(() => expect(statusText(container)).toContain('Checking…'));
    expect(spinner(container)?.className).toContain('animate-spin');

    releaseProbe();
    await flush();

    // Probe settled → Checking… clears, cached status text returns.
    await waitFor(() => expect(statusText(container)).not.toContain('Checking…'));
    expect(statusText(container)).toContain('Not installed');
    expect(spinner(container)?.className).not.toContain('animate-spin');
  });

  it('keeps background rechecks silent: loading flips without a click show no Checking…', async () => {
    const { container } = render(ProviderCard, {
      props: { ...baseProps(), provider: notInstalledProvider() },
    });

    // Simulate a background bulk recheck starting (focus/visibility poll).
    appStore.dispatch(setAllProvidersLoading({ opencode: true }));
    await flush();

    expect(statusText(container)).not.toContain('Checking…');
    expect(statusText(container)).toContain('Not installed');

    appStore.dispatch(checkSingleProviderSuccess('opencode', { available: false }));
    await flush();

    expect(statusText(container)).not.toContain('Checking…');
  });
});
