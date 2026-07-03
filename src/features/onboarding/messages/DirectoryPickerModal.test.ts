/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the DirectoryPickerModal initial-load effect: user
 * navigation (which updates the component-local `loadedFor`) must NOT re-run
 * the "load on open" effect, which previously re-requested the initial path
 * and bounced the listing back to home on every folder click.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

const mocks = vi.hoisted(() => {
  const dispatch = vi.fn();
  const listing = {
    path: '/Users/me',
    parent: '/Users',
    home: '/Users/me',
    entries: [
      { name: 'code', path: '/Users/me/code', isDirectory: true, isGitRepo: false },
      { name: 'repo', path: '/Users/me/repo', isDirectory: true, isGitRepo: true },
      { name: 'notes.txt', path: '/Users/me/notes.txt', isDirectory: false, isGitRepo: false },
    ],
  };
  return { dispatch, listing };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import(
    '$store/renderer/utils/test-helpers/store-mock'
  );
  return createAppStoreMockModule({
    state: () => ({
      directoryPicker: {
        listing: mocks.listing,
        loading: false,
        error: null,
        requestedPath: null,
      },
    }),
    dispatch: mocks.dispatch,
  });
});

vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import DirectoryPickerModal from './DirectoryPickerModal.svelte';
import {
  loadDirectoryRequested,
  resetDirectoryPicker,
} from '$store/renderer/slices/directory-picker/directory-picker-slice';

/** All `directoryPicker/loadRequested` actions dispatched so far. */
const loadCalls = (): Array<{ type: string; payload: unknown[] }> =>
  mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === loadDirectoryRequested.type);

/** Requested path of a loadRequested action (`undefined` = daemon-host home). */
const requestedPath = (action: { payload: unknown[] }) => action.payload?.[0];

const flush = async () => {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
};

beforeAll(() => {
  // jsdom does not implement Element#scrollTo (used after each navigation).
  Element.prototype.scrollTo = (() => {}) as never;
});

beforeEach(() => {
  mocks.dispatch.mockClear();
});

describe('DirectoryPickerModal navigation', () => {
  const baseProps = { open: true, onSelect: vi.fn(), onClose: vi.fn() };

  it('requests the daemon-host home once on open (no initialPath)', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const calls = loadCalls();
    expect(calls).toHaveLength(1);
    expect(requestedPath(calls[0])).toBeUndefined();
  });

  it('navigating into a folder does not re-request the initial path (regression)', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();
    expect(loadCalls()).toHaveLength(1);

    await fireEvent.click(screen.getByRole('option', { name: /code/ }));
    await flush();
    await flush();

    const calls = loadCalls();
    expect(calls).toHaveLength(2);
    expect(requestedPath(calls[1])).toBe('/Users/me/code');
    // The bug: the load-on-open effect tracked `loadedFor` and immediately
    // re-requested the initial path (home) after the navigation dispatch.
    expect(calls.slice(2)).toEqual([]);
  });

  it('still re-requests when initialPath changes while open', async () => {
    const { rerender } = render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();
    expect(loadCalls()).toHaveLength(1);

    await rerender({ ...baseProps, initialPath: '/Users/me/repo' });
    await flush();

    const calls = loadCalls();
    expect(calls).toHaveLength(2);
    expect(requestedPath(calls[1])).toBe('/Users/me/repo');
  });

  it('resets picker state when the modal closes', async () => {
    const { rerender } = render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    await rerender({ ...baseProps, open: false });
    await flush();

    const resets = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === resetDirectoryPicker.type);
    expect(resets).toHaveLength(1);
  });
});
