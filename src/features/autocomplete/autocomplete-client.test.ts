import { beforeEach, describe, expect, it, vi } from 'vitest';

const backendRequest = vi.hoisted(() => vi.fn());
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest }));
const debug = vi.hoisted(() => vi.fn());
vi.mock('$lib/utils/client-logger', () => ({ createLogger: () => ({ debug }) }));

import { AUTOCOMPLETE_REQUEST_TIMEOUT_MS, requestAutocompletion } from './autocomplete-client';

describe('requestAutocompletion', () => {
  beforeEach(() => {
    backendRequest.mockReset();
    debug.mockReset();
  });

  it('sends text and context to input.autocomplete and returns the completion', async () => {
    backendRequest.mockResolvedValue({ completion: ' the diff.' });
    await expect(requestAutocompletion('Show me', 'ctx')).resolves.toBe(' the diff.');
    expect(backendRequest).toHaveBeenCalledWith(
      'input.autocomplete',
      { text: 'Show me', context: 'ctx' },
      { timeoutMs: AUTOCOMPLETE_REQUEST_TIMEOUT_MS },
    );
  });

  it('folds a missing method or any error to an empty completion', async () => {
    backendRequest.mockRejectedValue(Object.assign(new Error('Method not found'), { code: -32601 }));
    await expect(requestAutocompletion('Show me', '')).resolves.toBe('');
    expect(debug).toHaveBeenCalledOnce();
  });

  it('folds a malformed result to an empty completion', async () => {
    backendRequest.mockResolvedValue({ completion: 42 });
    await expect(requestAutocompletion('Show me', '')).resolves.toBe('');
    backendRequest.mockResolvedValue(null);
    await expect(requestAutocompletion('Show me', '')).resolves.toBe('');
  });

  it('keeps the ghost to one bounded line', async () => {
    backendRequest.mockResolvedValue({ completion: `${'a'.repeat(300)}\nsecond line` });
    await expect(requestAutocompletion('Show me', '')).resolves.toBe('a'.repeat(200));
  });
});
