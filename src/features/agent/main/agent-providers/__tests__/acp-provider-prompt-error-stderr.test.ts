import { describe, expect, it } from 'vitest';

import {
  createUserFriendlyErrorMessage,
  derivePromptErrorSafeFallbackMessage,
  deriveSafeRawErrorMessage,
  extractCodexAcpStderrErrorMessage,
  formatRecentStderrForPromptError,
} from '../acp-provider';
import { cleanErrorMessage } from '../../../../../shared/errors/messages';

function rejectWithPromptErrorMessage(
  error: { code?: number; message?: unknown },
  recentStderrErrors: readonly string[],
): Promise<never> {
  const rawErrorMessage = deriveSafeRawErrorMessage(error, 'Unknown agent error');
  const safeFallbackMessage = derivePromptErrorSafeFallbackMessage(error, recentStderrErrors);
  const userFriendlyMessage = createUserFriendlyErrorMessage(
    rawErrorMessage,
    error.code || -1,
    'gpt-5.5',
    'codex',
    undefined,
    'workspace-test',
    safeFallbackMessage,
    true,
  );

  return Promise.reject(new Error(userFriendlyMessage));
}

describe('ACPProvider prompt error stderr surfacing', () => {
  it('uses the recent stderr tail for prompt JSON-RPC error rejections', async () => {
    const stderrTail = 'Provider rejected request because the selected model is unsupported.';

    await expect(
      rejectWithPromptErrorMessage(
        { code: -32603, message: 'Internal error' },
        ['earlier diagnostic', stderrTail],
      ),
    ).rejects.toThrow(stderrTail);
  });

  it('extracts codex-acp invalid_request_error stderr as the rejection message', async () => {
    const codexMessage =
      "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";
    const stderr = `Unhandled error during turn: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"${codexMessage}"}} Some(Other)`;

    expect(extractCodexAcpStderrErrorMessage(stderr)).toBe(codexMessage);

    await expect(
      rejectWithPromptErrorMessage({ code: -32603, message: 'Internal error' }, [stderr]),
    ).rejects.toThrow(codexMessage);
  });

  it('falls back to only the bounded raw stderr tail when no provider parser matches', () => {
    const stderr = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5', 'line 6'];

    expect(formatRecentStderrForPromptError(stderr)).toBe(
      ['line 2', 'line 3', 'line 4', 'line 5', 'line 6'].join('\n'),
    );
  });

  it('preserves the provider message through send-message UI error cleanup', () => {
    const providerMessage =
      "The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.";
    const wrapped = `send message failed after 3 attempts: Error invoking remote method 'agent:backend:stream-message': Error: ${providerMessage}`;

    expect(cleanErrorMessage(wrapped)).toBe(providerMessage);
  });
});