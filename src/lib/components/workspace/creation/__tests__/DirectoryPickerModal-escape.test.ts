/**
 * DirectoryPickerModal.svelte Escape handling via the escape-layer stack.
 *
 * Migrated from a `svelte:window` keydown branch. Semantics preserved:
 * Escape closes the picker, EXCEPT while the path input is focused — the
 * layer declines so the input's own handler cancels the edit instead.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

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

async function renderOpenPicker(onClose: () => void) {
  backendRequestMock.mockImplementation(((method: string) =>
    method === 'host.listDirectory'
      ? Promise.resolve(homeListing())
      : Promise.resolve(undefined)) as never);

  render(DirectoryPickerModal, {
    props: { open: true, initialPath: '', onSelect: vi.fn(), onClose },
  });

  await waitFor(() => {
    expect(document.body.querySelector('button[role="option"]')).toBeTruthy();
  });
}

describe('DirectoryPickerModal Escape handling (escape-layer stack)', () => {
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

  it('Escape closes the open picker', async () => {
    const onClose = vi.fn();
    await renderOpenPicker(onClose);

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('declines Escape while the path input is focused (edit cancelled, picker stays open)', async () => {
    const onClose = vi.fn();
    await renderOpenPicker(onClose);

    await fireEvent.click(screen.getByRole('button', { name: 'Enter a folder path' }));
    const pathInput = screen.getByLabelText('Path') as HTMLInputElement;
    pathInput.focus();
    await fireEvent.input(pathInput, { target: { value: '/tmp' } });
    await fireEvent.keyDown(pathInput, { key: 'Escape' });

    // The layer declined: picker did not close, and the input's own handler
    // cancelled edit mode back to the loaded-path breadcrumb.
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByLabelText('Path')).toBeNull();
      expect(screen.getByRole('button', { name: '~' })).toBeTruthy();
    });

    // Escape from a non-input target still closes.
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clears search without closing when Escape is pressed in the search input', async () => {
    const onClose = vi.fn();
    await renderOpenPicker(onClose);

    const searchInput = screen.getByRole('searchbox', {
      name: 'Filter folder contents',
    }) as HTMLInputElement;
    await fireEvent.input(searchInput, { target: { value: 'no-such-entry' } });
    // The filter is live: the lone entry is hidden while the search matches nothing.
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /code/ })).toBeNull();
    });

    await fireEvent.keyDown(searchInput, { key: 'Escape' });

    expect(searchInput.value).toBe('');
    // The layer's synthetic input event must sync searchDraft, un-filtering the
    // list — clearing input.value alone would leave the entries hidden.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /code/ })).toBeTruthy();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape is not consumed while the picker is closed (no layer registered)', async () => {
    render(DirectoryPickerModal, {
      props: { open: false, onSelect: vi.fn(), onClose: vi.fn() },
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
