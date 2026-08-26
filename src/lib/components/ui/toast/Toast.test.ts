import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import Toast from './Toast.svelte';
import AgentFailureToast from './AgentFailureToast.svelte';

vi.mock('$store/renderer/slices/theme/theme-selectors', () => ({
  selectIsDarkTheme: () => ({
    subscribe: (run: (value: boolean) => void) => {
      run(false);
      return () => undefined;
    },
  }),
}));

describe('Toast', () => {
  afterEach(() => {
    toast.dismiss();
    cleanup();
  });

  it('renders a success toast without entering a reactive update loop', async () => {
    render(Toast);

    toast.success('Saved successfully');

    expect(await screen.findByText('Saved successfully')).toBeTruthy();
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
  });

  it('renders stacked toasts expanded so a behind toast never collapses into a blank slab', async () => {
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
      expect(toastElements.every((el) => el.getAttribute('data-expanded') === 'true')).toBe(true),
    );
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
      'min(26rem, calc(100vw - clamp(2rem, 8vw, 4rem)))',
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
