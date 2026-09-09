import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => ({
  success: vi.fn(() => 'success-id'),
  info: vi.fn(() => 'info-id'),
  warning: vi.fn((_message: string, options?: { id?: string | number }) => options?.id ?? 1),
  error: vi.fn(() => 'error-id'),
  loading: vi.fn(() => 'progress-id'),
  custom: vi.fn(() => 'custom-id'),
  dismiss: vi.fn(),
}));

vi.mock('svelte-sonner', () => ({ toast: sonner }));

import NotifyErrorToast from './NotifyErrorToast.svelte';
import { NOTIFY_DURATION, notify } from './notify';

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('enforces the notification duration policy', () => {
    expect(NOTIFY_DURATION).toMatchObject({
      success: 2_000,
      info: 5_000,
      warning: 10_000,
      error: 15_000,
    });
  });

  it('coalesces repeated keys onto one stable toast id', () => {
    notify.success('Saving', { key: 'save:note-1' });
    notify.success('Saved', { key: 'save:note-1' });

    expect(sonner.success).toHaveBeenNthCalledWith(
      1,
      'Saving',
      expect.objectContaining({ id: 'save:note-1', duration: NOTIFY_DURATION.success }),
    );
    expect(sonner.success).toHaveBeenNthCalledWith(
      2,
      'Saved',
      expect.objectContaining({ id: 'save:note-1', duration: NOTIFY_DURATION.success }),
    );
  });

  it('renders structured error details with disclosure and copy affordance', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(NotifyErrorToast, {
      props: { message: 'Save failed', details: 'RPC -32000\nrequest id: 42' },
    });

    expect(document.querySelector('[data-toast-glyph="error"]')).toBeTruthy();
    const disclosure = screen.getByText(/Technical details/);
    const details = disclosure.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await fireEvent.click(disclosure);
    expect(details.open).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('RPC -32000\nrequest id: 42');
  });

  it('expires at the undo deadline and cancels expiry when undo runs', async () => {
    vi.useFakeTimers();
    const expire = vi.fn();
    const undo = vi.fn();

    notify.undoable('Archived', {
      key: 'archive:1',
      duration: 1_000,
      undoLabel: 'Undo',
      onUndo: undo,
      onExpire: expire,
    });
    const firstOptions = sonner.warning.mock.calls[0]?.[1];
    expect(firstOptions?.class).toContain('toast-countdown');
    await vi.advanceTimersByTimeAsync(999);
    expect(expire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expire).toHaveBeenCalledTimes(1);

    notify.undoable('Archived again', {
      key: 'archive:2',
      duration: 1_000,
      undoLabel: 'Undo',
      onUndo: undo,
      onExpire: expire,
    });
    const secondOptions = sonner.warning.mock.calls[1]?.[1];
    await secondOptions?.action?.onClick(new MouseEvent('click'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(sonner.dismiss).toHaveBeenCalledWith('archive:2');
  });

  it('returns a progress handle that updates and settles the same toast', () => {
    const handle = notify.progress('Uploading');
    handle.update('Uploading 50%');
    handle.success('Uploaded');

    expect(handle.id).toBe('progress-id');
    expect(sonner.loading).toHaveBeenLastCalledWith(
      'Uploading 50%',
      expect.objectContaining({ id: 'progress-id' }),
    );
    expect(sonner.success).toHaveBeenCalledWith(
      'Uploaded',
      expect.objectContaining({ id: 'progress-id' }),
    );
  });
});
