// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import ErrorBoundary from '../ErrorBoundary.svelte';

const children = createRawSnippet(() => ({
  render: () => '<div data-testid="boundary-child">child content</div>',
}));

// A child that throws `error` during render for the first `failures` renders, then renders
// normally. `failures = Infinity` never recovers. `onRender` observes every render attempt.
function throwingChildren(error: Error, failures: number, onRender?: () => void) {
  let attempts = 0;
  return createRawSnippet(() => ({
    render: () => {
      onRender?.();
      if (attempts++ < failures) throw error;
      return '<div data-testid="boundary-child">child content</div>';
    },
  }));
}

// Boundary error handling and reset() each run in their own microtask; let them all settle.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick();
}

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
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  describe('errors thrown during child render', () => {
    it('keeps the child content visible when a benign error is thrown during render', async () => {
      const onError = vi.fn();
      render(ErrorBoundary, {
        props: { children: throwingChildren(new Error('Invalid guestInstanceId: 3'), 1), onError },
      });
      await settle();

      expect(screen.getByTestId('boundary-child')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onError).not.toHaveBeenCalled();
    });

    it('still shows the error UI for an unrelated render error', async () => {
      const onError = vi.fn();
      const thrown = new Error('boom');
      render(ErrorBoundary, { props: { children: throwingChildren(thrown, 1), onError } });
      await settle();

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByTestId('boundary-child')).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(thrown);
    });

    it('falls back to the error UI when a benign render error keeps recurring', async () => {
      const onError = vi.fn();
      let renders = 0;
      const children = createRawSnippet(() => ({
        render: () => {
          renders++;
          throw new Error('Invalid guestInstanceId: 3');
        },
      }));
      render(ErrorBoundary, { props: { children, onError } });
      for (let i = 0; i < 10; i++) await settle();

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByTestId('boundary-child')).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      // Initial render plus a bounded number of resets — never an unbounded retry loop.
      expect(renders).toBeGreaterThan(1);
      expect(renders).toBeLessThanOrEqual(5);
    });

    it('does not replenish retries on elapsed time while every retry keeps failing', async () => {
      // Each failing render attempt costs 2s of wall time; retries are still consecutive
      // failures, so the boundary must settle on the error UI instead of recovering.
      let clock = 0;
      vi.spyOn(Date, 'now').mockImplementation(() => clock);
      const onError = vi.fn();
      let renders = 0;
      const children = throwingChildren(new Error('Invalid guestInstanceId: 3'), 6, () => {
        renders++;
        clock += 2000;
      });
      render(ErrorBoundary, { props: { children, onError } });
      for (let i = 0; i < 10; i++) await settle();

      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.queryByTestId('boundary-child')).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(renders).toBeLessThanOrEqual(5);
    });

    it('lets an explicit retry recover after the automatic retries were exhausted', async () => {
      const onError = vi.fn();
      // Fails the initial render, the automatic retries, and the first renders after the
      // explicit retry, then recovers within the replenished budget.
      const children = throwingChildren(new Error('Invalid guestInstanceId: 3'), 7);
      render(ErrorBoundary, { props: { children, onError } });
      for (let i = 0; i < 10; i++) await settle();
      expect(screen.getByRole('alert')).toBeTruthy();

      await fireEvent.click(
        screen.getByRole('button', { name: m.lib_errorBoundary_tryAgain_label() }),
      );
      for (let i = 0; i < 10; i++) await settle();

      expect(screen.getByTestId('boundary-child')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});
