/**
 * Wire-contract tests for `makeBackgroundRequest`.
 *
 * Asserts the service issues a single `agent.completeOnce` JSON-RPC call
 * (PROTOCOL §5.32) with the params the daemon expects — `{ prompt, model?,
 * timeoutMs, systemPrompt? }` (`model` omitted when the caller supplies
 * none, so the daemon/CLI default applies) — feeds it a PROTOCOL-shaped
 * `{ text }` reply, and asserts the caller-facing `{ success, content,
 * error? }` shape survives unchanged so the two existing consumers (intent
 * slug generator, note-status checker) continue to work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestSpy } = vi.hoisted(() => ({ requestSpy: vi.fn() }));
vi.mock('$features/backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: requestSpy }),
}));

import { BACKGROUND_REQUEST_TIMEOUT_MS } from '$shared/config/background-model';
import { makeBackgroundRequest } from '../background-request.service';

describe('makeBackgroundRequest (PROTOCOL §5.32 agent.completeOnce)', () => {
  beforeEach(() => {
    requestSpy.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('omits `model` when the caller supplies none (daemon/CLI default applies) and unwraps { text }', async () => {
    requestSpy.mockResolvedValue({ text: '  dark-mode  ' });

    const result = await makeBackgroundRequest({ prompt: 'name this task' });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith('agent.completeOnce', {
      prompt: 'name this task',
      timeoutMs: BACKGROUND_REQUEST_TIMEOUT_MS,
    });
    // Trimmed text becomes the caller-facing `content`.
    expect(result).toEqual({ success: true, content: 'dark-mode' });
  });

  it('omits `model` when the caller passes an empty string', async () => {
    requestSpy.mockResolvedValue({ text: 'ok' });

    await makeBackgroundRequest({ prompt: 'p', model: '' });

    expect(requestSpy).toHaveBeenCalledWith('agent.completeOnce', {
      prompt: 'p',
      timeoutMs: BACKGROUND_REQUEST_TIMEOUT_MS,
    });
  });

  it('adds `systemPrompt` when supplied and honours caller `model` / `timeoutMs`', async () => {
    requestSpy.mockResolvedValue({ text: 'complete' });

    await makeBackgroundRequest({
      prompt: 'classify',
      systemPrompt: 'You classify statuses.',
      model: 'auggie:some-model',
      timeoutMs: 5_000,
    });

    expect(requestSpy).toHaveBeenCalledWith('agent.completeOnce', {
      prompt: 'classify',
      systemPrompt: 'You classify statuses.',
      model: 'auggie:some-model',
      timeoutMs: 5_000,
    });
  });

  it('clamps `timeoutMs` at the 120000 daemon cap (matches PROTOCOL §5.32)', async () => {
    requestSpy.mockResolvedValue({ text: 'x' });

    await makeBackgroundRequest({ prompt: 'p', timeoutMs: 999_999 });

    expect(requestSpy).toHaveBeenCalledWith('agent.completeOnce', {
      prompt: 'p',
      timeoutMs: 120_000,
    });
  });

  it('falls back to the default timeout for non-positive / non-finite `timeoutMs`', async () => {
    requestSpy.mockResolvedValue({ text: 'x' });

    await makeBackgroundRequest({ prompt: 'p', timeoutMs: 0 });

    expect(requestSpy).toHaveBeenCalledWith('agent.completeOnce', {
      prompt: 'p',
      timeoutMs: BACKGROUND_REQUEST_TIMEOUT_MS,
    });
  });

  it('short-circuits before hitting the wire when `prompt` is empty', async () => {
    const result = await makeBackgroundRequest({ prompt: '' });

    expect(requestSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, error: 'prompt is required' });
  });

  it('surfaces daemon / transport errors as { success: false, error }', async () => {
    requestSpy.mockRejectedValue(new Error('CLI timed out after 5000ms'));

    const result = await makeBackgroundRequest({ prompt: 'p' });

    expect(result).toEqual({ success: false, error: 'CLI timed out after 5000ms' });
  });

  it('returns empty content when the daemon reply lacks a `text` field', async () => {
    requestSpy.mockResolvedValue({});

    const result = await makeBackgroundRequest({ prompt: 'p' });

    expect(result).toEqual({ success: true, content: '' });
  });
});
