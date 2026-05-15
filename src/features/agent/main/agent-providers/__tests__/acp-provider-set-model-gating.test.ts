/**
 * Regression tests for ACPProvider.setModel capability gating.
 *
 * The real set-model pipeline sends JSON-RPC requests over a spawned child
 * process, so we can't easily instantiate ACPProvider in a unit test.
 * Instead, these tests replicate the relevant slice of setModel's control
 * flow — the part that:
 *   1. Picks candidate methods based on providerCapabilities.id
 *   2. Filters out methods already known to be unsupported
 *   3. Walks the remaining methods, caching any -32601 ("Method not found")
 *      responses so they are skipped on subsequent calls
 *
 * If ACPProvider.setModel is ever refactored, update the `runSetModel` helper
 * below to mirror the new implementation exactly.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';

type SendRequest = (method: string) => Promise<{ error?: { code?: number; message?: string } }>;

interface GatingState {
  providerId: 'claude-code' | 'auggie' | 'codex' | string;
  unsupported: Set<string>;
  calls: string[];
  sendRequest: SendRequest;
}

/**
 * Mirrors the method-selection + caching branches of ACPProvider.setModel.
 * Returns the method actually used on success, or an error descriptor.
 */
async function runSetModel(
  state: GatingState,
): Promise<
  | { success: true; method: string }
  | { success: false; reason: 'no-methods'; unsupported: true; error: string }
  | { success: false; reason: 'loop-exhausted'; unsupported: true; error: string }
  | { success: false; reason: 'error' }
> {
  const candidateMethods =
    state.providerId === 'claude-code'
      ? ['unstable_setSessionModel', 'session/set_model']
      : ['session/set_model'];
  const methodsToTry = candidateMethods.filter((m) => !state.unsupported.has(m));
  if (methodsToTry.length === 0) {
    return {
      success: false,
      reason: 'no-methods',
      unsupported: true,
      error: 'No supported set-model method for this adapter',
    };
  }

  let allMethodNotFound = true;
  for (const method of methodsToTry) {
    state.calls.push(method);
    const response = await state.sendRequest(method);
    if (!response?.error) {
      return { success: true, method };
    }
    const code = response.error?.code;
    const message = response.error?.message || '';
    const isMethodNotFound =
      code === -32601 || (typeof message === 'string' && message.includes('Method not found'));
    if (isMethodNotFound) {
      state.unsupported.add(method);
      continue;
    }
    allMethodNotFound = false;
    return { success: false, reason: 'error' };
  }
  if (allMethodNotFound) {
    return {
      success: false,
      reason: 'loop-exhausted',
      unsupported: true,
      error: 'No supported set-model method for this adapter',
    };
  }
  return { success: false, reason: 'error' };
}

function makeState(providerId: GatingState['providerId'], sendRequest: SendRequest): GatingState {
  return { providerId, unsupported: new Set(), calls: [], sendRequest };
}

describe('ACPProvider.setModel capability gating', () => {
  it('claude-code: tries unstable_setSessionModel first, falls back on method-not-found', async () => {
    const state = makeState('claude-code', async (method) => {
      if (method === 'unstable_setSessionModel') {
        return { error: { code: -32601, message: 'Method not found' } };
      }
      return {}; // session/set_model succeeds
    });

    const result = await runSetModel(state);
    expect(result).toEqual({ success: true, method: 'session/set_model' });
    expect(state.calls).toEqual(['unstable_setSessionModel', 'session/set_model']);
    expect(state.unsupported.has('unstable_setSessionModel')).toBe(true);
  });

  it('caches method-not-found so the next setModel call skips the unsupported method', async () => {
    const state = makeState('claude-code', async (method) => {
      if (method === 'unstable_setSessionModel') {
        return { error: { code: -32601, message: 'Method not found' } };
      }
      return {};
    });

    await runSetModel(state); // first call: discovers unstable_setSessionModel is unsupported
    state.calls.length = 0;

    const result = await runSetModel(state); // second call: should skip directly to session/set_model
    expect(result).toEqual({ success: true, method: 'session/set_model' });
    expect(state.calls).toEqual(['session/set_model']);
  });

  it('returns no-methods when every candidate method has been cached as unsupported', async () => {
    let sendCount = 0;
    const state = makeState('claude-code', async () => {
      sendCount++;
      return { error: { code: -32601, message: 'Method not found' } };
    });

    await runSetModel(state); // exhausts both candidate methods
    state.calls.length = 0;
    const sendCountAfterFirstCall = sendCount;

    const result = await runSetModel(state);
    expect(result).toEqual({
      success: false,
      reason: 'no-methods',
      unsupported: true,
      error: 'No supported set-model method for this adapter',
    });
    // No additional JSON-RPC traffic should have been sent — that's the whole
    // point of the gating: avoid the WARN-log spam every turn.
    expect(sendCount).toBe(sendCountAfterFirstCall);
    expect(state.calls).toEqual([]);
  });

  it('first call with empty cache: all candidates return Method not found → unsupported:true (not generic failure)', async () => {
    // Guards the first-call all-unsupported path: when every candidate
    // set-model method returns -32601 on the first call (empty
    // unsupportedAcpMethods cache), the loop must exhaust and surface
    // `unsupported: true` so callers demote the log to DEBUG instead of
    // WARN-spamming every turn with a generic `Failed to set model` error.
    const state = makeState('claude-code', async () => ({
      error: { code: -32601, message: 'Method not found' },
    }));

    const result = await runSetModel(state);
    expect(result).toEqual({
      success: false,
      reason: 'loop-exhausted',
      unsupported: true,
      error: 'No supported set-model method for this adapter',
    });
    // Both candidate methods should have been tried and cached.
    expect(state.calls).toEqual(['unstable_setSessionModel', 'session/set_model']);
    expect(state.unsupported.has('unstable_setSessionModel')).toBe(true);
    expect(state.unsupported.has('session/set_model')).toBe(true);
  });


  it('auggie: only tries session/set_model (never unstable_setSessionModel)', async () => {
    const state = makeState('auggie', async () => {
      return { error: { code: -32601, message: 'Method not found' } };
    });
    await runSetModel(state);
    expect(state.calls).toEqual(['session/set_model']);
    expect(state.unsupported.has('unstable_setSessionModel')).toBe(false);
  });

  it('callers route the unsupported return to DEBUG instead of WARN', async () => {
    // Regression for the WARN-spam fix: callers check `result.unsupported`
    // and pick logger.debug when true. This test mirrors that branch.
    const warnCalls: unknown[][] = [];
    const debugCalls: unknown[][] = [];
    const fakeLogger = {
      warn: (...args: unknown[]) => warnCalls.push(args),
      debug: (...args: unknown[]) => debugCalls.push(args),
    };

    const state = makeState('auggie', async () => ({
      error: { code: -32601, message: 'Method not found' },
    }));
    await runSetModel(state); // exhausts candidates
    const result = await runSetModel(state);

    expect(result).toMatchObject({ success: false, unsupported: true });

    // Caller pattern: pick debug when unsupported, warn otherwise.
    if (!result.success) {
      const logFn = 'unsupported' in result && result.unsupported ? fakeLogger.debug : fakeLogger.warn;
      logFn('set-model failed', { error: 'error' in result ? result.error : undefined });
    }

    expect(debugCalls).toHaveLength(1);
    expect(warnCalls).toHaveLength(0);
  });

  it('stops on non-method-not-found errors and does not cache them', async () => {
    const state = makeState('claude-code', async (method) => {
      if (method === 'unstable_setSessionModel') {
        return { error: { code: -32602, message: 'Invalid params' } };
      }
      return {};
    });

    const result = await runSetModel(state);
    expect(result).toEqual({ success: false, reason: 'error' });
    // Non-method-not-found errors must not populate the cache — a bad
    // request shape one turn shouldn't permanently disable the method.
    expect(state.unsupported.has('unstable_setSessionModel')).toBe(false);
    expect(state.calls).toEqual(['unstable_setSessionModel']);
  });
});
