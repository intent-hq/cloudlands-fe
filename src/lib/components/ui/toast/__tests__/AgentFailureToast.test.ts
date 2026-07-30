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
});
