/**
 * AgentFailureToast component test — single-agent toast with Retry and
 * Switch To actions (no grouping, no detail lines).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import AgentFailureToast from '../AgentFailureToast.svelte';

describe('AgentFailureToast', () => {
  afterEach(cleanup);

  it('renders title, error, context line, and wires Retry / Switch To / close', async () => {
    const onRetry = vi.fn();
    const onSwitchTo = vi.fn();
    const onClose = vi.fn();
    render(AgentFailureToast, {
      props: {
        title: 'Implementor failed',
        errorSummary: 'spawn failed: EPERM',
        contextLine: 'Implementor — Fix login',
        retryLabel: 'Retry Implementor',
        retrying: false,
        onRetry,
        onSwitchTo,
        onClose,
      },
    });

    expect(screen.getByText('Implementor failed')).toBeTruthy();
    expect(screen.getByText('spawn failed: EPERM')).toBeTruthy();
    expect(screen.getByText('Implementor — Fix login')).toBeTruthy();

    await fireEvent.click(screen.getByText('Retry Implementor'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSwitchTo).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByText('Switch To'));
    expect(onSwitchTo).toHaveBeenCalledTimes(1);

    await fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables Retry while retrying but keeps Switch To enabled', () => {
    render(AgentFailureToast, {
      props: {
        title: 'Implementor failed',
        errorSummary: 'spawn failed: EPERM',
        retryLabel: 'Retry Implementor',
        retrying: true,
        onRetry: vi.fn(),
        onSwitchTo: vi.fn(),
        onClose: vi.fn(),
      },
    });

    const retryButton = screen.getByText('Retrying…').closest('button');
    expect(retryButton?.disabled).toBe(true);
    const switchButton = screen.getByText('Switch To').closest('button');
    expect(switchButton?.disabled).toBe(false);
  });

  it('renders login guidance with a copyable command and the claude desktop caveat', () => {
    render(AgentFailureToast, {
      props: {
        title: 'Coordinator failed',
        errorSummary: 'JSON-RPC error -32000: Authentication required',
        retryLabel: 'Retry Coordinator',
        retrying: false,
        loginCommandHint: 'claude /login',
        showClaudeDesktopNote: true,
        onRetry: vi.fn(),
        onSwitchTo: vi.fn(),
        onClose: vi.fn(),
      },
    });

    expect(screen.getByTestId('toast-auth-guidance')).toBeTruthy();
    expect(screen.getByTestId('toast-auth-login-command').textContent).toBe('claude /login');
    expect(screen.getByTestId('toast-auth-claude-desktop-note')).toBeTruthy();
    // The raw error stays visible alongside the guidance.
    expect(screen.getByText('JSON-RPC error -32000: Authentication required')).toBeTruthy();
  });

  it('omits login guidance when no hint is provided', () => {
    render(AgentFailureToast, {
      props: {
        title: 'Implementor failed',
        errorSummary: 'spawn failed: EPERM',
        retryLabel: 'Retry Implementor',
        retrying: false,
        onRetry: vi.fn(),
        onSwitchTo: vi.fn(),
        onClose: vi.fn(),
      },
    });

    expect(screen.queryByTestId('toast-auth-guidance')).toBeNull();
  });

  it('contains long unbroken JSON-RPC errors and keeps controls keyboard focusable', () => {
    const longError = `JSON-RPC error: ${'a'.repeat(800)}`;
    const { container } = render(AgentFailureToast, {
      props: {
        title: 'Implementor failed',
        errorSummary: longError,
        retryLabel: 'Retry Implementor',
        retrying: false,
        onRetry: vi.fn(),
        onSwitchTo: vi.fn(),
        onClose: vi.fn(),
      },
    });

    const root = container.firstElementChild as HTMLElement;
    const summary = screen.getByText(longError);
    const close = screen.getByLabelText('Close') as HTMLButtonElement;
    expect(root.classList.contains('w-full')).toBe(true);
    expect(root.classList.contains('min-w-0')).toBe(true);
    expect(summary.classList.contains('break-words')).toBe(true);
    close.focus();
    expect(document.activeElement).toBe(close);
    expect(close.type).toBe('button');
  });
});
