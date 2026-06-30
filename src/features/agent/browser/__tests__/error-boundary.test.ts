/**
 * AUDIT-P0-2 tests for `ErrorBoundaryService`.
 *
 * The previous `fallback` option silently masked retry-exhausted failures
 * as a success-shaped value. This suite locks in the new contract: wrap /
 * wrapSync / withErrorBoundary must always throw an AgentError once
 * attempts are exhausted, so callers see the failure and can render an
 * error state instead of trusting a fake success.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('svelte-sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

import { AgentError } from '../../errors/agent-errors';
import {
  errorBoundary,
  withErrorBoundary,
} from '../error-boundary.service';

describe('ErrorBoundary (AUDIT-P0-2)', () => {
  it('wrap throws AgentError after retries are exhausted (no fallback path)', async () => {
    const op = vi.fn(() => Promise.reject(new Error('always fails')));

    await expect(
      errorBoundary.wrap(op, 'test-op', { retries: 1, retryDelay: 1 }),
    ).rejects.toBeInstanceOf(AgentError);

    expect(op).toHaveBeenCalledTimes(2);
  });

  it('wrap resolves with the operation result on success', async () => {
    const op = vi.fn(() => Promise.resolve('ok'));

    await expect(errorBoundary.wrap(op, 'test-op')).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('wrap retries the configured number of times then throws', async () => {
    let calls = 0;
    const op = vi.fn(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error(`transient ${calls}`));
      return Promise.resolve('finally');
    });

    await expect(
      errorBoundary.wrap(op, 'test-op', { retries: 2, retryDelay: 1 }),
    ).resolves.toBe('finally');
    expect(calls).toBe(3);
  });

  it('wrapSync throws AgentError on failure (no fallback path)', () => {
    expect(() =>
      errorBoundary.wrapSync(
        () => {
          throw new Error('sync boom');
        },
        'sync-op',
      ),
    ).toThrow(AgentError);
  });

  it('wrapSync returns the value on success', () => {
    expect(errorBoundary.wrapSync(() => 42, 'sync-op')).toBe(42);
  });

  it('withErrorBoundary surfaces the wrapped failure to its caller', async () => {
    await expect(
      withErrorBoundary(
        () => Promise.reject(new Error('nope')),
        'wrap-test',
        { retries: 0 },
      ),
    ).rejects.toBeInstanceOf(AgentError);
  });
});
