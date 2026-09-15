import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import Toast from './Toast.svelte';
import AgentFailureToast from './AgentFailureToast.svelte';
import ErrorToast from './ErrorToast.svelte';
import ToastUndoAction from './ToastUndoAction.svelte';

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => undefined;
    },
  }),
}));

describe('Toast', () => {
  afterEach(async () => {
    toast.dismiss();
    // Since svelte-sonner 1.2, dismiss() only flags toasts; they leave the
    // module-level state when the still-mounted toaster's removal timer
    // fires. Wait for that (DOM removal tracks state removal) before
    // cleanup(), or dismissed toasts leak into the next test's toaster.
    await waitFor(() => expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(0));
    cleanup();
  });

  it('renders a success toast without entering a reactive update loop', async () => {
    render(Toast);

    toast.success('Saved successfully');

    expect(await screen.findByText('Saved successfully')).toBeTruthy();
  });

  it('renders the filled semantic glyph for every standard status variant', async () => {
    render(Toast);
    toast.success('Saved', { id: 'glyph-success', duration: Number.POSITIVE_INFINITY });
    toast.error('Failed', { id: 'glyph-error', duration: Number.POSITIVE_INFINITY });
    toast.warning('Warning', { id: 'glyph-warning', duration: Number.POSITIVE_INFINITY });
    toast.info('Information', { id: 'glyph-info', duration: Number.POSITIVE_INFINITY });
    toast.loading('Loading', { id: 'glyph-loading', duration: Number.POSITIVE_INFINITY });

    await screen.findByText('Loading');
    for (const variant of ['success', 'error', 'warning', 'info', 'loading']) {
      const glyph = document.querySelector(`[data-toast-glyph="${variant}"]`);
      expect(glyph?.querySelector('svg')).toBeTruthy();
    }
  });

  it('runs and dismisses a standard toast action through the shared action control', async () => {
    const onAction = vi.fn();
    render(Toast);
    toast.success('Workspace archived', {
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Undo', onClick: onAction },
    });

    const action = await screen.findByRole('button', { name: 'Undo' });
    action.focus();
    expect(document.activeElement).toBe(action);
    await fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Workspace archived')).toBeNull());
  });

  it('shows Clear all only for a stack and exposes count-aware live-region semantics', async () => {
    render(Toast);
    toast.success('First notification', { id: 'first', duration: Number.POSITIVE_INFINITY });
    expect(await screen.findByText('First notification')).toBeTruthy();
    expect(screen.queryByText('Clear all')).toBeNull();

    toast.error('Second notification', { id: 'second', duration: Number.POSITIVE_INFINITY });
    const clearAll = await screen.findByRole('button', {
      name: 'Dismiss all 2 notifications',
    });
    expect(clearAll.textContent).toContain('Clear all');
    expect(clearAll.getAttribute('aria-controls')).toBe('app-toast-region');
    expect(clearAll.getAttribute('type')).toBe('button');
    expect(screen.getByLabelText(/Notifications/)).toBeTruthy();

    toast.info('Third notification', { id: 'third', duration: Number.POSITIVE_INFINITY });
    expect(await screen.findByText('2 more')).toBeTruthy();
  });

  it('keeps stacked toasts collapsed until the stack is hovered', async () => {
    render(Toast);
    toast.success('Short front toast', { id: 'short', duration: Number.POSITIVE_INFINITY });
    toast.warning(
      'A much longer warning message that wraps onto multiple lines and is taller than the toast in front of it',
      { id: 'tall', duration: Number.POSITIVE_INFINITY },
    );

    await screen.findByText('Short front toast');
    await screen.findByText(/A much longer warning message/);
    const toastElements = Array.from(document.querySelectorAll<HTMLElement>('[data-sonner-toast]'));
    expect(toastElements).toHaveLength(2);
    await waitFor(() =>
      expect(toastElements.every((el) => el.getAttribute('data-expanded') === 'false')).toBe(true),
    );
    await fireEvent.mouseEnter(document.querySelector('[data-sonner-toaster]')!);
    await waitFor(() =>
      expect(toastElements.every((el) => el.getAttribute('data-expanded') === 'true')).toBe(true),
    );
  });

  it('orders application-error actions from recovery to low emphasis', () => {
    render(ErrorToast, {
      props: {
        error: {
          id: 'application-error',
          type: 'error',
          title: 'Workspace error',
          message: 'The workspace could not be opened.',
          timestamp: new Date('2026-09-07T00:00:00Z'),
          recoverable: true,
        },
        onRetry: vi.fn(),
        onDebug: vi.fn(),
        onCopy: vi.fn(),
      },
    });

    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Retry',
      'Debug with AI',
      'Copy',
      '',
    ]);
  });

  it('renders the undo keyboard shortcut as a kbd chip', () => {
    const { container } = render(ToastUndoAction);

    expect(container.querySelector('kbd[data-toast-shortcut]')?.textContent).toBe('⌘Z');
  });

  it('uses the same responsive width contract for standard and custom toasts', async () => {
    render(Toast);
    toast.success('Standard toast', { id: 'standard', duration: Number.POSITIVE_INFINITY });
    toast.custom(AgentFailureToast, {
      id: 'custom',
      duration: Number.POSITIVE_INFINITY,
      componentProps: {
        title: 'Implementor failed',
        errorSummary: 'JSON-RPC request failed',
        retryLabel: 'Retry Implementor',
        retrying: false,
        onRetry: vi.fn(),
        onSwitchTo: vi.fn(),
        onClose: vi.fn(),
      },
    });

    await screen.findByText('Implementor failed');
    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]');
    const toastElements = Array.from(document.querySelectorAll<HTMLElement>('[data-sonner-toast]'));
    expect(toaster).toBeTruthy();
    expect(toastElements).toHaveLength(2);
    expect(toaster!.style.getPropertyValue('--app-toast-width').trim()).toBe(
      'min(22rem, calc(100vw - clamp(2rem, 8vw, 4rem)))',
    );
    expect(new Set(toastElements.map((element) => getComputedStyle(element).width)).size).toBe(1);
    expect(toastElements.every((element) => element.classList.contains('w-full'))).toBe(true);
    expect(toastElements.every((element) => element.classList.contains('min-w-0'))).toBe(true);
  });

  it('clears presentation, supports keyboard focus, and allows a later stable-id re-raise', async () => {
    render(Toast);
    const showFailure = (summary: string) =>
      toast.custom(AgentFailureToast, {
        id: 'agent-failure:agent-1',
        duration: Number.POSITIVE_INFINITY,
        componentProps: {
          title: 'Implementor failed',
          errorSummary: summary,
          retryLabel: 'Retry Implementor',
          retrying: false,
          onRetry: vi.fn(),
          onSwitchTo: vi.fn(),
          onClose: vi.fn(),
        },
      });

    showFailure('First failure');
    toast.success('Saved', { id: 'saved', duration: Number.POSITIVE_INFINITY });
    const clearAll = await screen.findByRole('button', {
      name: 'Dismiss all 2 notifications',
    });
    clearAll.focus();
    expect(document.activeElement).toBe(clearAll);
    await fireEvent.click(clearAll);
    await waitFor(() => expect(screen.queryByText('Clear all')).toBeNull());

    await new Promise((resolve) => setTimeout(resolve, 250));
    showFailure('Newer failure');
    expect(await screen.findByText('Newer failure')).toBeTruthy();
    expect(screen.queryByText('Clear all')).toBeNull();
  });
});
