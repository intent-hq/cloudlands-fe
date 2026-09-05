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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

vi.mock('$lib/components/ui/Portal.svelte', async () => {
  const MockPortal = (await import('../../../modals/__tests__/mocks/MockPortal.svelte')).default;
  return { default: MockPortal };
});

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa, Fa: MockFa };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import {
  resetDirectoryPicker,
  type DirectoryPickerListing,
} from '$store/renderer/slices/directory-picker/directory-picker-slice';
import { directoryPickerSaga } from '$store/renderer/slices/directory-picker/sagas/directory-picker-saga';

import DirectoryPickerModal from '../DirectoryPickerModal.svelte';

const backendRequestMock = vi.mocked(backendRequest);
let stopDirectoryPickerSaga: (() => void) | undefined;

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
  stopDirectoryPickerSaga = appStore.runSaga(directoryPickerSaga);
});

afterAll(() => {
  stopDirectoryPickerSaga?.();
  stopDirectoryPickerSaga = undefined;
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

describe('DirectoryPickerModal — New Folder create → reload → select (real store + saga)', () => {
  it('creates the folder, reloads the listing, drops the stale highlight, and selects the new folder', async () => {
    const freshListing = (): DirectoryPickerListing => ({
      path: '/Users/me/fresh',
      parent: '/Users/me',
      home: '/Users/me',
      entries: [],
    });

    // The saga reloads the created path directly (it never re-requests home),
    // so the mock only answers the created path once the create has landed —
    // any other request order trips the unexpected-path rejection.
    let created = false;
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      const path = (params as { path?: string } | undefined)?.path;
      if (method === 'host.createDirectory') {
        created = true;
        return Promise.resolve(undefined);
      }
      if (method !== 'host.listDirectory') return Promise.resolve(undefined);
      if (path === undefined) return Promise.resolve(homeListing());
      if (path === '/Users/me/fresh' && created) return Promise.resolve(freshListing());
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    const onSelect = vi.fn();
    render(DirectoryPickerModal, {
      props: { open: true, initialPath: '', onSelect, onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me');
    });

    // Highlight an existing folder first — a successful create must not leave
    // this stale highlight in place after the listing reloads.
    await fireEvent.click(screen.getByRole('option', { name: /code/ }));
    expect(screen.getByRole('button', { name: 'Select "code"' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    const input = (await screen.findByRole('textbox', {
      name: 'New folder name',
    })) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'fresh' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    // The saga creates then reloads into the new folder.
    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me/fresh');
      expect(appStore.state.directoryPicker.loading).toBe(false);
    });

    // Exact wire order: initial home load, create, reload of the created path.
    expect(backendRequestMock.mock.calls).toEqual([
      ['host.listDirectory', {}],
      ['host.createDirectory', { path: '/Users/me/fresh' }],
      ['host.listDirectory', { path: '/Users/me/fresh' }],
    ]);

    // The stale "code" highlight is dropped: Select now targets the newly
    // created (open) directory, so the picker cannot submit the old path.
    const select = (await screen.findByRole('button', {
      name: 'Select "fresh"',
    })) as HTMLButtonElement;

    // No create error and the inline input is gone after the path change.
    expect(appStore.state.directoryPicker.createError).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(select.disabled).toBe(false);
    await fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/Users/me/fresh');
  });

  it('joins the folder name onto a trailing-slash root path without a double slash', async () => {
    const rootListing = (): DirectoryPickerListing => ({
      path: '/',
      parent: null,
      home: '/Users/me',
      entries: [],
    });
    const folderListing = (): DirectoryPickerListing => ({
      path: '/folder',
      parent: '/',
      home: '/Users/me',
      entries: [],
    });
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      const path = (params as { path?: string } | undefined)?.path;
      if (method === 'host.createDirectory') return Promise.resolve(undefined);
      if (method !== 'host.listDirectory') return Promise.resolve(undefined);
      if (path === undefined) return Promise.resolve(rootListing());
      if (path === '/folder') return Promise.resolve(folderListing());
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    render(DirectoryPickerModal, {
      props: { open: true, initialPath: '', onSelect: vi.fn(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/');
    });

    await fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    const input = (await screen.findByRole('textbox', {
      name: 'New folder name',
    })) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'folder' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    // `/` already ends with a slash — the join must not produce `//folder`.
    await waitFor(() => {
      const createCalls = backendRequestMock.mock.calls.filter(
        ([method]) => method === 'host.createDirectory',
      );
      expect(createCalls).toEqual([['host.createDirectory', { path: '/folder' }]]);
    });
  });

  it('a failed create keeps the listing, surfaces the error, and does not reload', async () => {
    backendRequestMock.mockImplementation(((method: string, params: unknown) => {
      const path = (params as { path?: string } | undefined)?.path;
      if (method === 'host.createDirectory') {
        return Promise.reject(new Error('Permission denied (os error 13)'));
      }
      if (method !== 'host.listDirectory') return Promise.resolve(undefined);
      if (path === undefined) return Promise.resolve(homeListing());
      return Promise.reject(new Error(`unexpected path ${String(path)}`));
    }) as never);

    render(DirectoryPickerModal, {
      props: { open: true, initialPath: '', onSelect: vi.fn(), onClose: vi.fn() },
    });

    await waitFor(() => {
      expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me');
    });

    await fireEvent.click(screen.getByRole('button', { name: 'New Folder' }));
    const input = (await screen.findByRole('textbox', {
      name: 'New folder name',
    })) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'denied' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(appStore.state.directoryPicker.createError).toBe('Permission denied (os error 13)');
    });

    // The listing survives, the inline error renders, the input stays open
    // with the typed name so the user can correct it, and no reload happened.
    expect(appStore.state.directoryPicker.listing?.path).toBe('/Users/me');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Permission denied (os error 13)');
    expect(
      (screen.getByRole('textbox', { name: 'New folder name' }) as HTMLInputElement).value,
    ).toBe('denied');
    const listCalls = backendRequestMock.mock.calls.filter(
      ([method]) => method === 'host.listDirectory',
    );
    expect(listCalls).toEqual([['host.listDirectory', {}]]);
  });
});
