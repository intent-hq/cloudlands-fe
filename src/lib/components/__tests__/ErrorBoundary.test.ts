// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../ErrorBoundary.svelte';

const children = createRawSnippet(() => ({
  render: () => '<div data-testid="boundary-child">child content</div>',
}));

async function dispatchWindowError(
  init: ErrorEventInit,
  options: { defaultPrevented?: boolean } = {},
): Promise<ErrorEvent> {
  const event = new ErrorEvent('error', { cancelable: true, ...init });
  if (options.defaultPrevented) event.preventDefault();
  window.dispatchEvent(event);
  // ErrorBoundary commits its state in a microtask, then Svelte flushes on tick.
  await Promise.resolve();
  await tick();
  return event;
}

describe('ErrorBoundary', () => {
  afterEach(cleanup);

  it('keeps rendering the child when the stale webview guest detach error is thrown', async () => {
    const onError = vi.fn();
    render(ErrorBoundary, { props: { children, onError } });

    const event = await dispatchWindowError({
      message: 'Uncaught Error: Invalid guestInstanceId: 3',
      error: new Error('Invalid guestInstanceId: 3'),
    });

    expect(screen.getByTestId('boundary-child')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores an unrelated error event that an earlier listener already suppressed', async () => {
    const onError = vi.fn();
    render(ErrorBoundary, { props: { children, onError } });

    await dispatchWindowError(
      { message: 'Uncaught Error: boom', error: new Error('boom') },
      { defaultPrevented: true },
    );

    expect(screen.getByTestId('boundary-child')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it('still shows the error UI for an unrelated error', async () => {
    const onError = vi.fn();
    render(ErrorBoundary, { props: { children, onError } });

    const thrown = new Error('boom');
    const event = await dispatchWindowError({ message: 'Uncaught Error: boom', error: thrown });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('boundary-child')).toBeNull();
    expect(onError).toHaveBeenCalledWith(thrown, undefined);
    expect(event.defaultPrevented).toBe(true);
  });

  it('suppresses a benign unhandled rejection instead of showing the error UI', async () => {
    const onError = vi.fn();
    render(ErrorBoundary, { props: { children, onError } });

    const event = new PromiseRejectionEvent('unhandledrejection', {
      cancelable: true,
      promise: Promise.resolve(),
      reason: new Error('Invalid guestInstanceId: 9'),
    });
    window.dispatchEvent(event);
    await Promise.resolve();
    await tick();

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTestId('boundary-child')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });
});
