import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdateToast from '../UpdateToast.svelte';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), status: 'downloaded' }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/auto-update/auto-update-selectors', () => {
  const readable = (value: unknown) => ({
    subscribe: (run: (value: unknown) => void) => {
      run(value);
      return () => undefined;
    },
  });
  return {
    selectAutoUpdateStatus: () => readable(mocks.status),
    selectAutoUpdateProgress: () => readable(null),
    selectAutoUpdateInfo: () => readable({ version: '4.2.0' }),
    selectAutoUpdateCurrentVersion: () => readable('4.1.0'),
    selectAutoUpdateError: () => readable(null),
  };
});

describe('UpdateToast actions', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it.each([
    ['downloaded', 'Install', 'autoUpdate/installUpdate'],
    ['available', 'Download', 'autoUpdate/downloadUpdate'],
  ])('dispatches the production %s action', async (status, label, type) => {
    mocks.status = status;
    render(UpdateToast);
    await fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith({ type, payload: [] });
  });

  it.each(['downloaded', 'available'] as const)(
    'keeps %s preview actions off the real updater',
    async (status) => {
      const action = vi.fn();
      render(UpdateToast, {
        props: { previewState: { status, onInstall: action, onDownload: action } },
      });
      await fireEvent.click(
        screen.getByRole('button', {
          name: status === 'downloaded' ? 'Install' : 'Download',
          exact: true,
        }),
      );
      expect(action).toHaveBeenCalledTimes(1);
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it.each(['downloaded', 'available'] as const)(
    'keeps callback-free %s previews inert',
    async (status) => {
      render(UpdateToast, { props: { previewState: { status } } });
      await fireEvent.click(
        screen.getByRole('button', {
          name: status === 'downloaded' ? 'Install' : 'Download',
          exact: true,
        }),
      );
      expect(mocks.dispatch).not.toHaveBeenCalled();
    },
  );

  it('keeps explicit dismissal separate from installing', async () => {
    const onDismiss = vi.fn();
    const closeToast = vi.fn();
    render(UpdateToast, {
      props: { previewState: { status: 'downloaded' }, onDismiss, closeToast },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(closeToast).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
