/**
 * Wire-contract tests for `runProviderTestPrompt` (host.providerTestPrompt,
 * PROTOCOL §5.14). FAKE transport only: `backendRequest` is mocked so no
 * request reaches a real daemon. Asserts the exact method + params emitted
 * and how PROTOCOL-shaped responses fold into the typed result.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

import { backendRequest } from '$lib/client/live/backend-transport';
import {
  __resetProviderAuthStatusForTests,
  getProviderAuthVerdicts,
} from './provider-auth-status.client';
import { runProviderTestPrompt } from './provider-test-prompt.client';

const mockedRequest = vi.mocked(backendRequest);

describe('runProviderTestPrompt wire contract (fake transport)', () => {
  afterEach(() => {
    __resetProviderAuthStatusForTests();
    mockedRequest.mockReset();
  });

  it('sends host.providerTestPrompt with providerId only when no model is given', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });

    const result = await runProviderTestPrompt({ providerId: 'claude-code' });

    expect(mockedRequest).toHaveBeenCalledWith(
      'host.providerTestPrompt',
      { providerId: 'claude-code' },
      { timeoutMs: 300_000 },
    );
    expect(result).toEqual({ ok: true });
  });

  it('invalidates the provider auth verdict after a successful setup probe', async () => {
    mockedRequest
      .mockResolvedValueOnce({ providers: [{ id: 'claude-code', authenticated: false }] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ providers: [{ id: 'claude-code', authenticated: true }] });

    await expect(getProviderAuthVerdicts()).resolves.toEqual({
      'claude-code': { authenticated: false },
    });
    await runProviderTestPrompt({ providerId: 'claude-code' });
    await expect(getProviderAuthVerdicts()).resolves.toEqual({
      'claude-code': { authenticated: true },
    });

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'host.providerAuthStatus', {});
    expect(mockedRequest).toHaveBeenNthCalledWith(3, 'host.providerAuthStatus', {});
  });

  it('includes model in the params when supplied', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: true });

    await runProviderTestPrompt({ providerId: 'codex', model: 'gpt-5' });

    expect(mockedRequest).toHaveBeenCalledWith(
      'host.providerTestPrompt',
      { providerId: 'codex', model: 'gpt-5' },
      { timeoutMs: 300_000 },
    );
  });

  it('returns the structured failure verbatim', async () => {
    mockedRequest.mockResolvedValueOnce({
      ok: false,
      reason: 'auth-required',
      message: 'not logged in',
    });

    const result = await runProviderTestPrompt({ providerId: 'claude-code' });

    expect(result).toEqual({ ok: false, reason: 'auth-required', message: 'not logged in' });
  });

  it('preserves unknown additive fields and reasons per the compatibility policy', async () => {
    mockedRequest.mockResolvedValueOnce({
      ok: false,
      reason: 'rate-limited',
      message: 'slow down',
      retryAfterMs: 5000,
    });

    const result = await runProviderTestPrompt({ providerId: 'codex' });

    expect(result).toEqual({
      ok: false,
      reason: 'rate-limited',
      message: 'slow down',
      retryAfterMs: 5000,
    });
  });

  it('rejects a divergent payload instead of silently absorbing it', async () => {
    mockedRequest.mockResolvedValueOnce({ ok: false, reason: '' });

    await expect(runProviderTestPrompt({ providerId: 'codex' })).rejects.toThrow();
  });

  it('propagates transport errors', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('daemon unreachable'));

    await expect(runProviderTestPrompt({ providerId: 'codex' })).rejects.toThrow(
      'daemon unreachable',
    );
  });
});
