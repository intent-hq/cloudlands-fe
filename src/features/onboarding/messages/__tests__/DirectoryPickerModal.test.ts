/**
 * @vitest-environment jsdom
 *
 * Regression tests for the "snap back to home on folder click" bug and the
 * typed-tilde-path commit flow (monorepo#824).
 *
 * When the picker modal opened with an empty `initialPath`, the open-effect
 * tracked `loadedFor`/`listing`. Clicking a folder called `requestDirectory`
 * which flipped `loadedFor` to the folder path — that re-fired the effect,
 * which then saw `loadedFor !== want` (`want` derived from `initialPath = ''`)
 * and dispatched an unwanted `loadDirectoryRequested()` (home). The slice's
 * `requestedPath` stale-guard then discarded the real folder listing, so the
 * user saw home instead of the folder they clicked.
 *
 * The fix reads `loadedFor` via `untrack` and only triggers a load when
 * `loadedFor === null` (fresh open — the close-effect resets it).
 *
 * The `hostListDirectoryCalls` assertion is what fails pre-fix: the modal
 * dispatches the folder request followed by an unwanted home request, so we
 * observe THREE calls (home, folder, home) instead of the expected two.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (
    await import('../../../../lib/components/modals/__tests__/mocks/MockPortal.svelte')
  ).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import {
  resetDirectoryPicker,
  type DirectoryPickerListing,
} from '$store/renderer/slices/directory-picker/directory-picker-slice';

import DirectoryPickerModal from '../DirectoryPickerModal.svelte';

const backendRequestMock = vi.mocked(backendRequest);

const homeListing = (): DirectoryPickerListing => ({
  path: '/Users/me',
  parent: null,
  home: '/Users/me',
  entries: [{ name: 'code', path: '/Users/me/code', isDirectory: true, isGitRepo: false }],
});

const codeListing = (): DirectoryPickerListing => ({
  path: '/Users/me/code',
  parent: '/Users/me',
  home: '/Users/me',
  entries: [
    { name: 'project', path: '/Users/me/code/project', isDirectory: true, isGitRepo: true },
  ],
});

// jsdom doesn't implement Element.scrollTo; the picker calls it in a
// queueMicrotask after each dispatch. Stub it (and init the store) at file
// level so every suite is self-sufficient under name-filtered runs.
beforeAll(() => {
  if (!('scrollTo' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollTo', {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
  if (!('scrollIntoView' in Element.prototype)) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
  appStore.init();
});

afterEach(() => {
  cleanup();
  backendRequestMock.mockReset();
  appStore.dispatch(resetDirectoryPicker());
});

describe('DirectoryPickerModal — folder open does not snap back to home', () => {
  it('opening a folder loads that folder and never re-requests home', async () => {
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== 'host.listDirectory') return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === undefined) return Promise.resolve(homeListing());
      if (path === '/Users/me/code') return Promise.resolve(codeListing());
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    render(DirectoryPickerModal, {
      props: {
        open: true,
        initialPath: '',
        onSelect: vi.fn(),
        onClose: vi.fn(),
      },
    });

    // Wait for the home listing to render — the "code" folder button appears.
    const codeButton = await waitFor(() => {
      const el = document.body.querySelector('button[role="option"]');
      if (!el) throw new Error('home listing not rendered yet');
      return el as HTMLButtonElement;
    });
    expect(codeButton.textContent).toContain('code');

    await fireEvent.dblClick(codeButton);

    // Post-fix: the store settles on the folder listing.
    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me/code');
      expect(appStore.state.directoryPicker.loading).toBe(false);
    });

    // Exactly two host.listDirectory dispatches: initial home, then the folder.
    // Pre-fix: a third (unwanted) home call is issued when `loadedFor` flips,
    // and the folder response is discarded by the slice's stale-guard.
    const hostListDirectoryPaths = backendRequestMock.mock.calls
      .filter(([method]) => method === 'host.listDirectory')
      .map(([, params]) => (params as { path?: string } | undefined)?.path);

    expect(hostListDirectoryPaths).toEqual([undefined, '/Users/me/code']);
    expect(appStore.state.directoryPicker.requestedPath).toBe('/Users/me/code');
  });
});

describe('DirectoryPickerModal — typed tilde path commit (monorepo#824)', () => {
  it('commits a typed ~/ path even when the initial listing failed (no listing.home)', async () => {
    // Fresh picker whose initial (home) listing failed — any rejection of the
    // home load lands in `directoryListingFailed` (the missing-path fallback
    // only applies to explicit-path loads), so no listing — and therefore no
    // `listing.home` — is available. The client-side `expandTypedPath` fast
    // path cannot expand, so the raw `~/src` must go over the wire and the
    // daemon-expanded listing must be applied (host.listDirectory expands
    // leading `~` / `~/` itself).
    const srcListing = (): DirectoryPickerListing => ({
      path: '/Users/me/src',
      parent: '/Users/me',
      home: '/Users/me',
      entries: [{ name: 'proj', path: '/Users/me/src/proj', isDirectory: true, isGitRepo: true }],
    });

    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== 'host.listDirectory') return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === undefined) return Promise.reject(new Error('connection reset'));
      if (path === '~/src') return Promise.resolve(srcListing());
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    render(DirectoryPickerModal, {
      props: {
        open: true,
        initialPath: '',
        onSelect: vi.fn(),
        onClose: vi.fn(),
      },
    });

    // Wait for the failed initial load to settle: no listing, error shown.
    await waitFor(() => {
      expect(appStore.state.directoryPicker.loading).toBe(false);
      expect(appStore.state.directoryPicker.error).toBe('connection reset');
      expect(appStore.state.directoryPicker.listing).toBeNull();
    });

    const editPath = document.body.querySelector(
      'button[aria-label="Enter a folder path"]',
    ) as HTMLButtonElement;
    await fireEvent.click(editPath);
    const input = document.body.querySelector('input[aria-label="Path"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '~/src' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    // The daemon-expanded listing is applied despite the missing home.
    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me/src');
      expect(appStore.state.directoryPicker.pathError).toBeNull();
    });

    // The raw tilde path crossed the wire unchanged (daemon-side expansion) —
    // exact params: `{}` for the home load, `{ path }` for the typed path.
    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === 'host.listDirectory',
    );
    expect(hostListDirectoryCalls).toEqual([
      ['host.listDirectory', {}],
      ['host.listDirectory', { path: '~/src' }],
    ]);
  });

  it('expands a typed ~/ path client-side when listing.home is available (fast path)', async () => {
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      if (method !== 'host.listDirectory') return Promise.resolve(undefined);
      const path = (params as { path?: string } | undefined)?.path;
      if (path === undefined) return Promise.resolve(homeListing());
      if (path === '/Users/me/src') {
        return Promise.resolve({
          path: '/Users/me/src',
          parent: '/Users/me',
          home: '/Users/me',
          entries: [],
        } satisfies DirectoryPickerListing);
      }
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    render(DirectoryPickerModal, {
      props: {
        open: true,
        initialPath: '',
        onSelect: vi.fn(),
        onClose: vi.fn(),
      },
    });

    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me');
    });

    const editPath = document.body.querySelector(
      'button[aria-label="Enter a folder path"]',
    ) as HTMLButtonElement;
    await fireEvent.click(editPath);
    const input = document.body.querySelector('input[aria-label="Path"]') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '~/src' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me/src');
    });

    // The fast path expanded before hitting the wire — exact params.
    const hostListDirectoryCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === 'host.listDirectory',
    );
    expect(hostListDirectoryCalls).toEqual([
      ['host.listDirectory', {}],
      ['host.listDirectory', { path: '/Users/me/src' }],
    ]);
  });
});
