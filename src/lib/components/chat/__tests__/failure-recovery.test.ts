/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/utils/workspace-navigation', () => ({ navigateToSettings: vi.fn() }));
import StreamingStatus from '../StreamingStatus.svelte';
import TurnFailureNotice from '../TurnFailureNotice.svelte';
afterEach(cleanup);

describe('compact failure recovery', () => {
  it('shows the cause and copies the exact raw failure from Details', async () => {
    const raw =
      'JSON-RPC error -32603: workspace requirements failed\n  cause: exact internal detail';
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onRetry = vi.fn();
    render(StreamingStatus, { error: raw, onRetry });
    expect(screen.getByTestId('error-title').textContent).toBe('Response failed');
    expect(screen.getByTestId('error-message').textContent).toBe(
      'JSON-RPC error -32603: workspace requirements failed',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Details', exact: true }));
    expect(screen.getByTestId('failure-raw-details').textContent).toBe(raw);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(writeText).toHaveBeenCalledWith(raw);
    await fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it('keeps queued recovery to Retry and removes it during activity', async () => {
    const view = render(StreamingStatus, {
      error: 'raw',
      recoveryState: 'queued',
      onRetry: vi.fn(),
    });
    expect(screen.queryByText(/queued|will retry/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    await view.rerender({ recoveryState: 'attempting', isProcessing: true });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Retry', exact: true })).toBeNull(),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await view.rerender({ recoveryState: 'inactive', isProcessing: false, error: null });
    expect(screen.queryByTestId('failure-recovery-card')).toBeNull();
  });
  it('keeps read-only failures inspectable without offering a send', () => {
    render(StreamingStatus, { error: 'raw' });
    expect(screen.getByRole('button', { name: 'Details', exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry', exact: true })).toBeNull();
  });
  it('renders neutral historical records without erasing duplicate-current evidence', async () => {
    render(TurnFailureNotice, {
      records: [
        { messageId: 'one', reason: 'first raw', timestamp: '2026-10-07T06:00:00Z' },
        { messageId: 'two', reason: 'second raw', timestamp: '2026-10-07T06:01:00Z' },
      ],
    });
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Response failed' }));
    expect(screen.getByText('first raw')).toBeTruthy();
    expect(screen.getByText('second raw')).toBeTruthy();
    expect(screen.queryByText(/attempts|recovered/i)).toBeNull();
  });
});
