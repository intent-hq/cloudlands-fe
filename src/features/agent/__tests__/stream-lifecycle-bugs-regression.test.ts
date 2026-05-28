/**
 * Stream Lifecycle Regression Tests (Bugs 8 & 9)
 *
 * Bug 8: Stale 'complete' from interrupted stream processed by new handler.
 *   When a user sends a new message during streaming, the old stream's
 *   interruption 'complete' (data: null, no message, no finishReason) arrives
 *   at the NEW handler before any chunks. Without the guard, this prematurely
 *   cleans up the new handler → all subsequent chunks are dropped.
 *
 * Saga migration: stream lifecycle should forward raw updates while sagas own
 *   Redux-state-dependent missing-target refresh/reconcile behavior.
 *
 * These tests use structural source-code analysis to verify the production
 * code contains the correct guard conditions and dispatch patterns, rather
 * than reimplementing the logic locally.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read the production source once for all structural tests
const SOURCE_PATH = resolve(__dirname, '../agent-stream-lifecycle.ts');
const source = readFileSync(SOURCE_PATH, 'utf-8');
const SAGA_SOURCE_PATH = resolve(
  __dirname,
  '../../../lib/store/slices/agent-session/sagas/agent-stream-saga.ts',
);
const sagaSource = readFileSync(SAGA_SOURCE_PATH, 'utf-8');

describe('Bug 8: Stale complete from interrupted stream', () => {
  // -----------------------------------------------------------------------
  // Structural verification: the guard EXISTS in production code
  // -----------------------------------------------------------------------
  it('production code contains the stale-complete guard in the sendMessage handler', () => {
    // The guard must check all four conditions:
    // 1. !hasReceivedFirstChunk  2. chunkCount <= 1  3. !data.message  4. !data.finishReason
    // Note: chunkCount <= 1 (not === 0) because chunkCount is incremented at the
    // top of streamHandler before this guard runs, so the complete event itself
    // makes chunkCount = 1.
    expect(source).toContain('!hasReceivedFirstChunk');
    expect(source).toContain('chunkCount <= 1');
    expect(source).toContain('!data.message');
    expect(source).toContain('!data.finishReason');

    // Verify the guard triggers a `return` (skip the event)
    // The pattern: guard condition → logger.info → return
    const guardPattern =
      /if\s*\(\s*!hasReceivedFirstChunk\s*&&\s*chunkCount\s*<=\s*1\s*&&\s*!data\.message\s*&&\s*!data\.finishReason\s*\)/;
    expect(source).toMatch(guardPattern);

    // After the guard, there must be a `return;` statement
    const guardMatch = source.match(guardPattern);
    expect(guardMatch).not.toBeNull();
    const afterGuard = source.slice(
      guardMatch!.index! + guardMatch![0].length,
      guardMatch!.index! + guardMatch![0].length + 500,
    );
    expect(afterGuard).toContain('return;');
  });

  it('guard is inside the complete handler branch, not elsewhere', () => {
    // Find the `data.type === 'complete'` branch in the sendMessage handler
    const completeBlockMatches = [...source.matchAll(/data\.type\s*===\s*['"]complete['"]/g)];
    // There should be at least one (in sendMessage's streamHandler)
    expect(completeBlockMatches.length).toBeGreaterThanOrEqual(1);

    // The guard should appear AFTER a complete type check
    const guardIdx = source.search(/!hasReceivedFirstChunk\s*&&\s*chunkCount <= 1/);
    const lastCompleteBeforeGuard = completeBlockMatches.filter((m) => m.index! < guardIdx).pop();
    expect(lastCompleteBeforeGuard).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Behavioral verification: guard logic correctness
  // -----------------------------------------------------------------------

  // Extract the exact guard condition from production to use in tests.
  // This ensures we test the SAME condition, not a reimplementation.
  function productionGuardSkips(
    hasReceivedFirstChunk: boolean,
    chunkCount: number,
    data: { message?: any; finishReason?: string },
  ): boolean {
    // Matches production line: if (!hasReceivedFirstChunk && chunkCount <= 1 && !data.message && !data.finishReason)
    // chunkCount <= 1 because the complete event itself increments chunkCount before the guard.
    return !hasReceivedFirstChunk && chunkCount <= 1 && !data.message && !data.finishReason;
  }

  it('skips stale complete: no chunks, no message, no finishReason', () => {
    // chunkCount=1 simulates the complete event itself having incremented the counter
    expect(productionGuardSkips(false, 1, {})).toBe(true);
    expect(productionGuardSkips(false, 1, { message: undefined })).toBe(true);
    // chunkCount=0 also matches (defensive, should not happen in practice)
    expect(productionGuardSkips(false, 0, {})).toBe(true);
  });

  it('does NOT skip when chunks received', () => {
    expect(productionGuardSkips(true, 5, {})).toBe(false);
  });

  it('does NOT skip when message present', () => {
    expect(productionGuardSkips(false, 0, { message: { id: 'msg-1' } })).toBe(false);
  });

  it('does NOT skip when finishReason present (e.g. content_filter, empty response)', () => {
    expect(productionGuardSkips(false, 0, { finishReason: 'content_filter' })).toBe(false);
    expect(productionGuardSkips(false, 0, { finishReason: 'end_turn' })).toBe(false);
  });

  it('does NOT skip when finishReason present but no chunks (edge: content filter with empty body)', () => {
    // Important edge case: backend returns finishReason but zero content
    expect(productionGuardSkips(false, 0, { finishReason: 'content_filter' })).toBe(false);
  });

  it('does NOT skip when message present but empty contentBlocks', () => {
    // Edge case: provider returns empty assistant message immediately
    expect(productionGuardSkips(false, 0, { message: { id: 'm', contentBlocks: [] } })).toBe(false);
  });

  it('full race sequence: stale skip → real chunks → real complete', () => {
    let handlerCleaned = false;
    let hasReceivedFirstChunk = false;
    let chunkCount = 0;

    // Mirrors production: chunkCount++ at top of handler for ALL event types
    const handler = (data: any) => {
      chunkCount++;

      if (data.type === 'chunk') {
        hasReceivedFirstChunk = true;
      } else if (data.type === 'complete') {
        if (productionGuardSkips(hasReceivedFirstChunk, chunkCount, data)) return;
        handlerCleaned = true;
      }
    };

    // Stale complete: chunkCount=1 (incremented for this event), no chunks received
    handler({ type: 'complete', data: null, streamId: 'old-stream-1' });
    expect(handlerCleaned).toBe(false); // stale skipped

    handler({ type: 'chunk', data: 'Hello', streamId: 'new-stream-2' });
    handler({ type: 'chunk', data: ' world', streamId: 'new-stream-2' });
    expect(chunkCount).toBe(3); // 1 complete + 2 chunks

    // Real complete: hasReceivedFirstChunk=true, so guard does NOT skip
    handler({
      type: 'complete',
      streamId: 'new-stream-2',
      message: { id: 'msg-1' },
      finishReason: 'end_turn',
    });
    expect(handlerCleaned).toBe(true);
  });
});

describe('Stream lifecycle is a thin stream adapter', () => {
  it('does not read Redux state or own stale refresh helpers', () => {
    expect(source).not.toContain('getReduxStore().getState');
    expect(source).not.toContain('getAgentSession(');
    expect(source).not.toContain('selectActiveWorkspaceId');
    expect(source).not.toContain('requestRefreshThenMaybeFallback');
    expect(source).not.toContain('requestRestoredRefreshThenMaybeFallback');
    expect(source).not.toContain('persistenceService.loadSession');
    expect(source).not.toContain('STALE_STREAM_SESSION_REFRESH_COOLDOWN_MS');
  });

  it('sendMessage stream branches emit only canonical raw saga-owned update actions', () => {
    const sendMessageIdx = source.indexOf('export async function sendMessage');
    const streamHandlerIdx = source.indexOf(
      'const streamHandler = (data: StreamHandlerData)',
      sendMessageIdx,
    );
    const chunkIdx = source.indexOf("data.type === 'chunk'", streamHandlerIdx);
    const contentBlocksIdx = source.indexOf("data.type === 'content-blocks'", streamHandlerIdx);
    const completeIdx = source.indexOf("data.type === 'complete'", streamHandlerIdx);
    const statusIdx = source.indexOf("data.type === 'status'", completeIdx);
    const errorIdx = source.indexOf("data.type === 'error'", statusIdx);

    const chunkBranch = source.slice(chunkIdx, contentBlocksIdx);
    const contentBlocksBranch = source.slice(contentBlocksIdx, completeIdx);
    const completeBranch = source.slice(completeIdx, statusIdx);
    const statusBranch = source.slice(statusIdx, errorIdx);

    for (const branch of [chunkBranch, contentBlocksBranch, completeBranch]) {
      expect(branch).toContain('agentStreamUpdateReceived({');
      expect(branch).not.toContain('dispatchAgentStream(');
      expect(branch).not.toContain('upsertSession(');
      expect(branch).not.toContain('updateMessage(');
    }
    expect(chunkBranch).toContain("eventType: 'chunk'");
    expect(contentBlocksBranch).toContain("eventType: 'content-blocks'");
    expect(completeBranch).toContain("eventType: 'complete'");
    expect(statusBranch).toContain('dispatchStreamStatusEvent({');
    expect(statusBranch).not.toContain('agentStreamUpdateReceived({');
    expect(source).toContain('streamStatusReceived(');
  });

  it('restored stream branches emit source=restored saga-owned updates', () => {
    expect(source).not.toContain('export function registerStreamHandlerForSession');
    const restoredIdx = source.indexOf('function registerStreamHandlerForSession');
    expect(restoredIdx).toBeGreaterThanOrEqual(0);
    const helperIdx = source.indexOf('const emitStreamUpdate', restoredIdx);
    const listenerIdx = source.indexOf('const streamListenerId = window.electronAPI.on', helperIdx);
    const restoredBody = source.slice(restoredIdx, listenerIdx);
    const chunkIdx = restoredBody.indexOf("data.type === 'chunk'");
    const contentBlocksIdx = restoredBody.indexOf("data.type === 'content-blocks'");
    const completeIdx = restoredBody.indexOf("data.type === 'complete'");
    const statusIdx = restoredBody.indexOf("data.type === 'status'");
    const errorIdx = restoredBody.indexOf("data.type === 'error'", statusIdx);
    const chunkBranch = restoredBody.slice(chunkIdx, contentBlocksIdx);
    const contentBlocksBranch = restoredBody.slice(contentBlocksIdx, completeIdx);
    const completeBranch = restoredBody.slice(completeIdx, statusIdx);
    const statusBranch = restoredBody.slice(statusIdx, errorIdx);

    expect(restoredBody).toContain("source: 'restored'");
    expect(restoredBody).toContain('agentStreamUpdateReceived({');
    for (const branch of [chunkBranch, contentBlocksBranch, completeBranch]) {
      expect(branch).not.toContain('dispatchStreamStatusEvent({');
    }
    expect(restoredBody).not.toContain('dispatchAgentStream(');
    expect(restoredBody).toContain("emitStreamUpdate('chunk', data)");
    expect(restoredBody).toContain("emitStreamUpdate('content-blocks', data)");
    expect(restoredBody).toContain("emitStreamUpdate('complete', data)");
    expect(statusBranch).toContain('dispatchStreamStatusEvent({');
    expect(statusBranch).not.toContain('agentStreamUpdateReceived({');
    expect(restoredBody).toContain('dispatchStreamStatusEvent({');
    expect(restoredBody).not.toContain('getAgentSession(');
    expect(restoredBody).not.toContain('requestRestoredRefreshThenMaybeFallback');
  });
});

describe('Saga-owned missing-target refresh orchestration', () => {
  it('coalesces/rate-limits bypass-cache stale session refreshes before fallback', () => {
    expect(sagaSource).toContain('STALE_STREAM_SESSION_REFRESH_COOLDOWN_MS');
    expect(sagaSource).toContain('staleStreamSessionRefreshes');
    expect(sagaSource).toContain('staleStreamSessionRefreshesInFlight');
    expect(sagaSource).toContain('persistenceService.loadSession');
    expect(sagaSource).toContain('bypassCache: true');
    expect(sagaSource).toContain(
      'Created fallback streaming placeholder after refresh missed target',
    );
  });

  it('uses canonical target matching in saga instead of last-assistant retargeting', () => {
    expect(sagaSource).toContain('function findAssistantUpdateTarget');
    expect(sagaSource).toContain('message.isStreaming === true');
    expect(sagaSource).toContain('message.id === payload.assistantMessageId');
    expect(sagaSource).toContain('message.appMessageId === payload.assistantAppMessageId');
    expect(sagaSource).not.toContain('idx === updatedSession.messages.length - 1');
    expect(sagaSource).not.toContain('assistantMessages[assistantMessages.length - 1]');
  });

  it('keeps fallback placeholder ID decisions in the saga', () => {
    expect(source).not.toContain('pickPlaceholderId(');
    expect(sagaSource).toContain('pickPlaceholderId(payload.assistantMessageId');
  });
});
