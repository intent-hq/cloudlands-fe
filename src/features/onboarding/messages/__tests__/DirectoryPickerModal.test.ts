/**
 * @vitest-environment jsdom
 *
 * Regression test for the "snap back to home on folder click" bug.
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
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (
    await import('../../../../lib/components/modals/__tests__/mocks/MockPortal.svelte')
  ).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (
    await import('../../../../lib/components/ui/__tests__/mocks/Fa.svelte')
  ).default;
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
  entries: [
    { name: 'code', path: '/Users/me/code', isDirectory: true, isGitRepo: false },
  ],
});

const codeListing = (): DirectoryPickerListing => ({
  path: '/Users/me/code',
  parent: '/Users/me',
  home: '/Users/me',
  entries: [
    { name: 'project', path: '/Users/me/code/project', isDirectory: true, isGitRepo: true },
  ],
});

describe('DirectoryPickerModal — folder click does not snap back to home', () => {
  beforeAll(() => {
    // jsdom doesn't implement Element.scrollTo; the picker calls it in a
    // queueMicrotask after each dispatch. Stub it so the test doesn't surface
    // an unhandled "scrollTo is not a function" error.
    if (!('scrollTo' in Element.prototype)) {
      Object.defineProperty(Element.prototype, 'scrollTo', {
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

  it('clicking a folder loads that folder and never re-requests home', async () => {
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

    await fireEvent.click(codeButton);

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
