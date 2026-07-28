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
  // Mutable so individual tests can render with a typed-path or create hint.
  const overrides = {
    pathError: null as string | null,
    createError: null as string | null,
  };
  return { dispatch, listing, overrides };
});

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({
      directoryPicker: {
        listing: mocks.listing,
        loading: false,
        error: null,
        requestedPath: null,
        pathError: mocks.overrides.pathError,
        createError: mocks.overrides.createError,
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
  clearCreateDirectoryError,
  createDirectoryRequested,
  clearPathNavigationError,
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
  Element.prototype.scrollIntoView = (() => {}) as never;
});

beforeEach(() => {
  mocks.dispatch.mockClear();
  mocks.overrides.pathError = null;
  mocks.overrides.createError = null;
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

    await fireEvent.dblClick(screen.getByRole('option', { name: /code/ }));
    await flush();
    await flush();

    const calls = loadCalls();
    expect(calls).toHaveLength(2);
    expect(requestedPath(calls[1])).toBe('/Users/me/code');
    // The bug: the load-on-open effect tracked `loadedFor` and immediately
    // re-requested the initial path (home) after the navigation dispatch.
    expect(calls.slice(2)).toEqual([]);
  });

  it('does not re-request when initialPath changes while open (fix 92303cfc)', async () => {
    // The load-on-open effect is gated on `loadedFor === null` (fresh open
    // after modal close), so parent-driven initialPath changes while open do
    // NOT snap the picker back to the new initial path. The next fresh open
    // will pick up the current initialPath value naturally.
    const { rerender } = render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();
    expect(loadCalls()).toHaveLength(1);

    await rerender({ ...baseProps, initialPath: '/Users/me/repo' });
    await flush();

    expect(loadCalls()).toHaveLength(1);
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

  it('derives standard favorites from home and hides files', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    for (const label of ['Home', 'Desktop', 'Documents', 'Downloads', 'Computer']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('option', { name: 'notes.txt' })).toBeNull();
  });

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(DirectoryPickerModal, { props: { ...baseProps, onClose } });
    await flush();

    await fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DirectoryPickerModal editable path input', () => {
  const baseProps = { open: true, onSelect: vi.fn(), onClose: vi.fn() };

  const pathInput = async (): Promise<HTMLInputElement> => {
    await fireEvent.click(screen.getByRole('button', { name: 'Enter a folder path' }));
    return screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement;
  };

  it('shows the collapsed display path in the input', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    // listing.path === listing.home, so the display form is `~`.
    expect((await pathInput()).value).toBe('~');
  });

  it('typing a path and pressing Enter dispatches navigateToPathRequested', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const input = await pathInput();
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

    const input = await pathInput();
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

    const input = await pathInput();
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

    const input = await pathInput();
    await fireEvent.input(input, { target: { value: '/typo/pat' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await flush();

    expect(screen.queryByRole('textbox', { name: 'Path' })).toBeNull();
    expect(screen.getByRole('button', { name: '~' })).toBeTruthy();
    expect(navigateCalls()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('committing the unchanged current path does not dispatch a navigation', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    const input = await pathInput();
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
    const input = await pathInput();
    await fireEvent.input(input, { target: { value: '/does/not/exist' } });
    expect(
      mocks.dispatch.mock.calls.some(([action]) => action?.type === clearPathNavigationError.type),
    ).toBe(true);
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(input.value).toBe('/does/not/exist');
  });

  it('typing Backspace in the input does not navigate up', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();
    expect(loadCalls()).toHaveLength(1);

    const input = await pathInput();
    await fireEvent.input(input, { target: { value: '/tmp/x' } });
    await fireEvent.keyDown(input, { key: 'Backspace' });
    await flush();

    // No extra loadDirectoryRequested (navigate-up) beyond the load-on-open.
    expect(loadCalls()).toHaveLength(1);
  });
});

describe('DirectoryPickerModal directory mode (default)', () => {
  const baseProps = { open: true, onSelect: vi.fn(), onClose: vi.fn() };

  it('hides files from the listing', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(screen.queryByRole('option', { name: /notes\.txt/ })).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('the select button is enabled and commits the current directory', async () => {
    const onSelect = vi.fn();
    render(DirectoryPickerModal, { props: { ...baseProps, onSelect } });
    await flush();

    const select = screen.getByRole('button', { name: 'Select folder' }) as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    await fireEvent.click(select);

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/Users/me');
  });
});

describe('DirectoryPickerModal file mode', () => {
  const baseProps = { open: true, mode: 'file' as const, onSelect: vi.fn(), onClose: vi.fn() };

  const selectButton = (): HTMLButtonElement =>
    screen.getByRole('button', { name: 'Select file' }) as HTMLButtonElement;

  it('lists files alongside directories', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(screen.getByRole('option', { name: /notes\.txt/ })).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('disables the select button until a file is chosen', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(selectButton().disabled).toBe(true);

    await fireEvent.click(screen.getByRole('option', { name: /notes\.txt/ }));
    await flush();

    expect(selectButton().disabled).toBe(false);
  });

  it('clicking a file then Select commits the file path', async () => {
    const onSelect = vi.fn();
    render(DirectoryPickerModal, { props: { ...baseProps, onSelect } });
    await flush();

    await fireEvent.click(screen.getByRole('option', { name: /notes\.txt/ }));
    await flush();
    await fireEvent.click(selectButton());

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('/Users/me/notes.txt');
  });

  it('opening a directory still navigates and clears the chosen file', async () => {
    const onSelect = vi.fn();
    render(DirectoryPickerModal, { props: { ...baseProps, onSelect } });
    await flush();

    await fireEvent.click(screen.getByRole('option', { name: /notes\.txt/ }));
    await flush();
    expect(selectButton().disabled).toBe(false);

    await fireEvent.dblClick(screen.getByRole('option', { name: /code/ }));
    await flush();

    const calls = loadCalls();
    expect(calls).toHaveLength(2);
    expect(requestedPath(calls[1])).toBe('/Users/me/code');
    expect(selectButton().disabled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('clicking a file does not dispatch a navigation', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();
    expect(loadCalls()).toHaveLength(1);

    await fireEvent.click(screen.getByRole('option', { name: /notes\.txt/ }));
    await flush();

    expect(loadCalls()).toHaveLength(1);
  });

  it('does not show the New Folder button', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(screen.queryByRole('button', { name: 'New Folder' })).toBeNull();
  });
});

describe('DirectoryPickerModal New Folder', () => {
  const baseProps = { open: true, onSelect: vi.fn(), onClose: vi.fn() };

  /** All `directoryPicker/createDirectoryRequested` actions dispatched so far. */
  const createCalls = (): Array<{ type: string; payload: unknown[] }> =>
    mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === createDirectoryRequested.type);

  const newFolderButton = (): HTMLButtonElement =>
    screen.getByRole('button', { name: 'New Folder' }) as HTMLButtonElement;

  const nameInput = (): HTMLInputElement =>
    screen.getByRole('textbox', { name: 'New folder name' }) as HTMLInputElement;

  it('shows the New Folder button in directory mode', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(newFolderButton().disabled).toBe(false);
  });

  it('clicking New Folder reveals the name input', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    await fireEvent.click(newFolderButton());
    await flush();

    expect(nameInput()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New Folder' })).toBeNull();
  });

  it('typing a name and pressing Enter dispatches createDirectoryRequested with the joined path', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    await fireEvent.click(newFolderButton());
    await flush();

    const input = nameInput();
    await fireEvent.input(input, { target: { value: 'new-folder' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    const calls = createCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload[0]).toBe('/Users/me/new-folder');
    // Enter inside the input must not act as list navigation.
    expect(loadCalls()).toHaveLength(1); // only the load-on-open request
  });

  it('trims the typed name and ignores an empty commit', async () => {
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    await fireEvent.click(newFolderButton());
    await flush();

    const input = nameInput();
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(createCalls()).toHaveLength(0);

    await fireEvent.input(input, { target: { value: '  spaced  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();

    const calls = createCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload[0]).toBe('/Users/me/spaced');
  });

  it('Escape cancels the input without closing the modal', async () => {
    const onClose = vi.fn();
    render(DirectoryPickerModal, { props: { ...baseProps, onClose } });
    await flush();

    await fireEvent.click(newFolderButton());
    await flush();

    const input = nameInput();
    await fireEvent.input(input, { target: { value: 'abandoned' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    await flush();

    expect(screen.queryByRole('textbox', { name: 'New folder name' })).toBeNull();
    expect(newFolderButton()).toBeTruthy();
    expect(createCalls()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape after a failed create also clears the hint', async () => {
    mocks.overrides.createError = 'Permission denied';
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    await fireEvent.click(newFolderButton());
    await flush();

    await fireEvent.keyDown(nameInput(), { key: 'Escape' });
    await flush();

    const clears = mocks.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === clearCreateDirectoryError.type);
    expect(clears).toHaveLength(1);
  });

  it('renders the failure hint and keeps the typed name for correction', async () => {
    mocks.overrides.createError = 'Permission denied';
    render(DirectoryPickerModal, { props: { ...baseProps } });
    await flush();

    expect(screen.getByRole('alert').textContent?.trim()).toBe('Permission denied');

    // The listing is still rendered — the failed creation did not clear it.
    expect(screen.getByRole('option', { name: /code/ })).toBeTruthy();

    await fireEvent.click(newFolderButton());
    await flush();
    const input = nameInput();
    await fireEvent.input(input, { target: { value: 'denied' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    // The mock store never updates, so the input survives with its value.
    expect(nameInput().value).toBe('denied');
  });
});
