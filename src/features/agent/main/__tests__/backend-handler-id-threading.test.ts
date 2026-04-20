/**
 * Backend handler ID-threading tests
 *
 * Verifies the ID-assignment logic used in agent-backend-handler.service.ts:
 *
 * 1. When `request.assistantMessageId` is provided, BOTH the streaming
 *    placeholder AND the finalized assistant message use that exact ID.
 * 2. When `request.assistantMessageId` is absent, the backend falls back
 *    to a freshly-minted `msg_*` ID.
 *
 * These tests exercise the ID-threading pattern in isolation rather than
 * instantiating the full AgentBackendHandler (which has hundreds of
 * dependencies).  The code under test mirrors the logic at:
 *   - Streaming placeholder: lines ~2845-2849
 *   - Finalized message: lines ~3264-3267
 */

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simulate the streaming-placeholder ID assignment from
 * handleBackendStreamMessage's chunk handler (~line 2845-2849).
 */
function resolveStreamingMessageId(
  existingStreamingMsg: { id: string } | undefined,
  requestAssistantMessageId: string | undefined,
): string {
  // Mirrors the backend logic:
  //   id: existingStreamingMsgIndex >= 0
  //     ? backendSession.messages[existingStreamingMsgIndex].id
  //     : (request.assistantMessageId || `msg_${uuidv4()}`)
  if (existingStreamingMsg) {
    return existingStreamingMsg.id;
  }
  return requestAssistantMessageId || `msg_${uuidv4()}`;
}

/**
 * Simulate the finalized-message ID assignment from
 * handleBackendStreamMessage's complete handler (~line 3264-3267).
 */
function resolveFinalizedMessageId(
  requestAssistantMessageId: string | undefined,
  providerMessageId: string | undefined,
): string {
  // Mirrors the backend logic:
  //   id: request.assistantMessageId || providerMessage?.id || `msg_${uuidv4()}`
  return requestAssistantMessageId || providerMessageId || `msg_${uuidv4()}`;
}

describe('Backend handler ID-threading', () => {
  const RENDERER_MSG_ID = `msg_${uuidv4()}`;

  describe('when assistantMessageId is provided by the renderer', () => {
    it('uses that ID for the streaming placeholder (new message)', () => {
      const id = resolveStreamingMessageId(undefined, RENDERER_MSG_ID);
      expect(id).toBe(RENDERER_MSG_ID);
    });

    it('uses that ID for the finalized assistant message', () => {
      const id = resolveFinalizedMessageId(RENDERER_MSG_ID, undefined);
      expect(id).toBe(RENDERER_MSG_ID);
    });

    it('streaming and finalized IDs match each other', () => {
      const streamingId = resolveStreamingMessageId(undefined, RENDERER_MSG_ID);
      const finalizedId = resolveFinalizedMessageId(RENDERER_MSG_ID, undefined);
      expect(streamingId).toBe(finalizedId);
    });

    it('preserves the existing streaming message ID on subsequent chunks', () => {
      // First chunk creates the streaming message with the renderer's ID
      const firstChunkId = resolveStreamingMessageId(undefined, RENDERER_MSG_ID);
      expect(firstChunkId).toBe(RENDERER_MSG_ID);

      // Subsequent chunks find the existing streaming message and keep its ID
      const subsequentId = resolveStreamingMessageId(
        { id: firstChunkId },
        RENDERER_MSG_ID,
      );
      expect(subsequentId).toBe(RENDERER_MSG_ID);
    });
  });

  describe('when assistantMessageId is absent (fallback)', () => {
    it('generates a fresh msg_-prefixed ID for the streaming placeholder', () => {
      const id = resolveStreamingMessageId(undefined, undefined);
      expect(id).toMatch(/^msg_/);
    });

    it('generates a fresh msg_-prefixed ID for the finalized message', () => {
      const id = resolveFinalizedMessageId(undefined, undefined);
      expect(id).toMatch(/^msg_/);
    });

    it('uses provider message ID when available', () => {
      const providerMsgId = `msg_${uuidv4()}`;
      const id = resolveFinalizedMessageId(undefined, providerMsgId);
      expect(id).toBe(providerMsgId);
    });

    it('assistantMessageId takes precedence over provider message ID', () => {
      const providerMsgId = `msg_${uuidv4()}`;
      const id = resolveFinalizedMessageId(RENDERER_MSG_ID, providerMsgId);
      expect(id).toBe(RENDERER_MSG_ID);
    });
  });
});
