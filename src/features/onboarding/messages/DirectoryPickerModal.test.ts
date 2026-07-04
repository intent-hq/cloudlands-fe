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
  // Mutable so individual tests can render with a typed-path failure hint.
  const overrides = { pathError: null as string | null };
  return { dispatch, listing, overrides };
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
        pathError: mocks.overrides.pathError,
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
  navigateToPathRequested,
  resetDirectoryPicker,
} from '$store/renderer/slices/directory-picker/directory-picker-slice';

/** All `directoryPicker/loadRequested` actions dispatched so far. */
const loadCalls = (): Array<{ type: string; payload: unknown[] }> =>
  mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === loadDirectoryRequested.type);

/** All `directoryPicker/navigateToPathRequested` actions dispatched so far. */
const navigateCalls = (): Array<{ type: string; payload: unknown[] }> =>
  mocks.dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action?.type === navigateToPathRequested.type);

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
  mocks.overrides.pathError = null;
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

describe('DirectoryPickerModal editable path input', () => {
  const baseProps = { open: true, onSelect: vi.fn(), onClose: vi.fn() };

  const pathInput = (): HTMLInputElement =>
    screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement;

  it('shows the collapsed display path in the input', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    // listing.path === listing.home, so the display form is `~`.
    expect(pathInput().value).toBe('~');
  });

  it('typing a path and pressing Enter dispatches navigateToPathRequested', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const input = pathInput();
    await fireEvent.input(input, { target: { value: '/tmp/projects' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    const calls = navigateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload[0]).toBe('/tmp/projects');
    // Enter inside the input must not act as list navigation.
    expect(loadCalls()).toHaveLength(1); // only the load-on-open request
  });

  it('expands a leading ~ to the daemon-host home before dispatching', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const input = pathInput();
    await fireEvent.input(input, { target: { value: '~/src' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    const calls = navigateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload[0]).toBe('/Users/me/src');
  });

  it('blur commits the typed path like Enter', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const input = pathInput();
    await fireEvent.input(input, { target: { value: '/tmp/elsewhere' } });
    await fireEvent.blur(input);
    await flush();

    const calls = navigateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload[0]).toBe('/tmp/elsewhere');
  });

  it('Escape cancels the edit, restores the path, and does not close the modal', async () => {
    const onClose = vi.fn();
    render(DirectoryPickerModal, { props: { ...baseProps, onClose } });
    await flush();

    const input = pathInput();
    await fireEvent.input(input, { target: { value: '/typo/pat' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await flush();

    expect(input.value).toBe('~');
    expect(navigateCalls()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('committing the unchanged current path does not dispatch a navigation', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const input = pathInput();
    // Re-typing the same collapsed path expands back to the current listing path.
    await fireEvent.input(input, { target: { value: '~' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    expect(navigateCalls()).toHaveLength(0);
  });

  it('renders the failure hint and keeps the typed value for correction', async () => {
    mocks.overrides.pathError = 'Path not found';
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(screen.getByRole('alert').textContent?.trim()).toBe('Path not found');

    // The listing is still rendered — the failed navigation did not clear it.
    expect(screen.getByRole('option', { name: /code/ })).toBeTruthy();

    // A failed commit keeps the typed value in the input for correction.
    const input = pathInput();
    await fireEvent.input(input, { target: { value: '/does/not/exist' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(input.value).toBe('/does/not/exist');
  });

  it('typing Backspace in the input does not navigate up', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();
    expect(loadCalls()).toHaveLength(1);

    const input = pathInput();
    await fireEvent.input(input, { target: { value: '/tmp/x' } });
    await fireEvent.keyDown(input, { key: 'Backspace' });
    await flush();

    // No extra loadDirectoryRequested (navigate-up) beyond the load-on-open.
    expect(loadCalls()).toHaveLength(1);
  });
});
