// Regression coverage for the suite-wide wait limit set in src/test-setup.ts, for Testing
// Library's async utilities and vitest's `vi.waitFor` / `vi.waitUntil`.
// Testing Library's own 1s default failed a slow but correct cold first render on a loaded
// CI runner and ejected a green cloudlands-fe#3915 from the merge queue. Waits now follow
// half the CI-scaled test budget; a real hang must still fail at that limit, with the wait's
// own message, before the test timeout.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfig, screen, waitFor } from '@testing-library/svelte';
import { defaultAsyncUtilTimeoutMs, defaultTestTimeoutMs } from '../../scripts/vitest-timeouts.mjs';
import {
  installViWaitDefaultTimeout,
  withDefaultWaitTimeout,
  type ViWaits,
} from '../../src/test/vi-wait-default-timeout';

/** Longer than Testing Library's built-in 1s default, far shorter than the new limit. */
const SLOW_BUT_CORRECT_MS = 1_500;

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('defaultAsyncUtilTimeoutMs', () => {
  it('is half the test budget: 15s locally and 30s on CI', () => {
    expect(defaultAsyncUtilTimeoutMs({})).toBe(15_000);
    expect(defaultAsyncUtilTimeoutMs({ CI: 'false' })).toBe(15_000);
    expect(defaultAsyncUtilTimeoutMs({ CI: 'true' })).toBe(30_000);
  });

  it('leaves the rest of the test budget for the wait to report a hang itself', () => {
    for (const env of [{}, { CI: 'true' }]) {
      expect(defaultAsyncUtilTimeoutMs(env)).toBeGreaterThan(1_000);
      expect(defaultAsyncUtilTimeoutMs(env)).toBeLessThan(defaultTestTimeoutMs(env));
    }
  });
});

describe('Testing Library wait limit', () => {
  // Two cases: @testing-library/svelte restores its config after every test, so the
  // second proves the limit survives that restore instead of applying only once.
  it.each(['first', 'second'])('is the CI-scaled default in the %s test of a file', () => {
    expect(getConfig().asyncUtilTimeout).toBe(defaultAsyncUtilTimeoutMs());
  });

  it('lets a mock called after more than 1s satisfy waitFor', async () => {
    const onReady = vi.fn();
    setTimeout(onReady, SLOW_BUT_CORRECT_MS);
    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });

  it('lets an element rendered after more than 1s satisfy findBy', async () => {
    setTimeout(() => {
      const ready = document.createElement('p');
      ready.textContent = 'Slow but ready';
      document.body.append(ready);
    }, SLOW_BUT_CORRECT_MS);
    expect(await screen.findByText('Slow but ready')).toBeTruthy();
  });

  it('still fails a condition that never holds, at the limit, with the last assertion', async () => {
    vi.useFakeTimers();
    const neverCalled = vi.fn();
    let settled: { error: unknown } | undefined;
    void waitFor(() => expect(neverCalled).toHaveBeenCalled()).then(
      () => (settled = { error: undefined }),
      (error: unknown) => (settled = { error }),
    );

    await vi.advanceTimersByTimeAsync(defaultAsyncUtilTimeoutMs() - 100);
    expect(settled, 'waitFor gave up before the configured limit').toBeUndefined();

    await vi.advanceTimersByTimeAsync(200);
    expect(settled, 'waitFor did not give up at the configured limit').toBeDefined();
    expect(String((settled as { error: unknown }).error)).toMatch(
      /expected "(vi\.fn|spy)\(\)" to be called at least once/,
    );
  });

  it('still fails a findBy that never matches, naming what it looked for', async () => {
    vi.useFakeTimers();
    let settled: { error: unknown } | undefined;
    void screen.findByText('Never rendered').then(
      () => (settled = { error: undefined }),
      (error: unknown) => (settled = { error }),
    );

    await vi.advanceTimersByTimeAsync(defaultAsyncUtilTimeoutMs() + 100);
    expect(settled, 'findBy did not give up at the configured limit').toBeDefined();
    expect(String((settled as { error: unknown }).error)).toContain(
      'Unable to find an element with the text: Never rendered',
    );
  });
});

describe('withDefaultWaitTimeout', () => {
  it('fills in the default only when the call chose no timeout', () => {
    expect(withDefaultWaitTimeout(undefined, 15_000)).toEqual({ timeout: 15_000 });
    expect(withDefaultWaitTimeout({ interval: 10 }, 15_000)).toEqual({
      interval: 10,
      timeout: 15_000,
    });
    expect(withDefaultWaitTimeout({ timeout: 50 }, 15_000)).toEqual({ timeout: 50 });
    expect(withDefaultWaitTimeout({ timeout: 0 }, 15_000)).toEqual({ timeout: 0 });
    expect(withDefaultWaitTimeout(50, 15_000)).toBe(50);
  });
});

describe('installViWaitDefaultTimeout', () => {
  it('rewraps the original on a repeat install instead of nesting wrappers', async () => {
    const waitFor = vi.fn(async () => 'for');
    const waitUntil = vi.fn(async () => 'until');
    const target = { waitFor, waitUntil } as unknown as ViWaits;
    installViWaitDefaultTimeout(target, 15_000);
    installViWaitDefaultTimeout(target, 20_000);

    await expect(target.waitFor((() => true) as never)).resolves.toBe('for');
    await expect(target.waitUntil((() => true) as never, { interval: 5 })).resolves.toBe('until');
    expect(waitFor).toHaveBeenCalledOnce();
    expect(waitFor).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Function), { interval: 5, timeout: 20_000 });
  });
});

describe('vi.waitFor / vi.waitUntil wait limit', () => {
  it('lets a mock called after more than 1s satisfy vi.waitFor', async () => {
    const onReady = vi.fn();
    setTimeout(onReady, SLOW_BUT_CORRECT_MS);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
  });

  it('lets a condition that holds after more than 1s satisfy vi.waitUntil', async () => {
    let ready = false;
    setTimeout(() => (ready = true), SLOW_BUT_CORRECT_MS);
    await expect(vi.waitUntil(() => ready)).resolves.toBe(true);
  });

  it('still honours an explicit short timeout, failing with the last assertion', async () => {
    const neverCalled = vi.fn();
    const started = Date.now();
    await expect(vi.waitFor(() => expect(neverCalled).toHaveBeenCalled(), 50)).rejects.toThrow(
      /expected "(vi\.fn|spy)\(\)" to be called at least once/,
    );
    await expect(vi.waitUntil(() => false, { timeout: 50 })).rejects.toThrow(
      'Timed out in waitUntil!',
    );
    expect(Date.now() - started).toBeLessThan(defaultAsyncUtilTimeoutMs());
  });
});
