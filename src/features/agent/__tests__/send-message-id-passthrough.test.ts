/**
 * Renderer-side ID pass-through tests
 *
 * Verifies the ID generation and pass-through patterns used by sendMessage
 * and restored-stream handler setup in agent-stream-lifecycle.ts.
 *
 * Instead of mocking the entire sendMessage call chain, we test the specific
 * ID-generation pattern and the reconnect-path placeholder ID format directly.
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  createMessageId,
  isValidMessageId,
} from '$shared/types/branded-ids';
import { pickPlaceholderId } from '../utils/pick-placeholder-id';

describe('Renderer-side assistant message ID generation', () => {
  describe('sendMessage ID pattern', () => {
    it('generates a msg_-prefixed ID that passes createMessageId validation', () => {
      // This is the exact pattern used in sendMessage (line ~1107):
      //   const assistantMessageId = createMessageId(`msg_${uuidv4()}`);
      const assistantMessageId = createMessageId(`msg_${uuidv4()}`);

      expect(typeof assistantMessageId).toBe('string');
      expect(assistantMessageId).toMatch(/^msg_/);
      expect(isValidMessageId(assistantMessageId)).toBe(true);
    });

    it('produces IPC payload shape with assistantMessageId field', () => {
      const assistantMessageId = createMessageId(`msg_${uuidv4()}`);

      // Simulate the IPC payload constructed in sendMessage (lines ~2115-2138)
      const payload = {
        agentId: `agent-${uuidv4()}`,
        sessionId: `agent-${uuidv4()}`,
        content: 'Hello',
        workspaceId: uuidv4(),
        assistantMessageId,
      };

      expect(payload.assistantMessageId).toBe(assistantMessageId);
      expect(payload.assistantMessageId).toMatch(/^msg_/);
    });
  });

  describe('reconnect-path placeholder ID format', () => {
    // Mirrors the production guard in agent-stream-lifecycle.ts:
    //   const reusableExistingMessageId =
    //     existingMessage?.isStreaming &&
    //     typeof existingMessage.id === 'string' &&
    //     existingMessage.id.startsWith('msg_')
    //       ? existingMessage.id
    //       : undefined;
    // and the two placeholder-creation sites:
    //   id: reusableExistingMessageId || createMessageId('msg_' + uuidv4())
    function resolvePlaceholderId(
      existingMessage?: { id?: string; isStreaming?: boolean },
    ): string {
      const reusable =
        existingMessage?.isStreaming &&
        typeof existingMessage.id === 'string' &&
        existingMessage.id.startsWith('msg_')
          ? existingMessage.id
          : undefined;
      return reusable || createMessageId('msg_' + uuidv4());
    }

    it('generates msg_-prefixed IDs for reconnect placeholders (no existing message)', () => {
      const id = resolvePlaceholderId(undefined);

      expect(id).toMatch(/^msg_/);
      expect(isValidMessageId(id)).toBe(true);
    });

    it('reuses existingMessage.id only when it is streaming AND canonical', () => {
      const existingId = createMessageId(`msg_${uuidv4()}`);
      const id = resolvePlaceholderId({ id: existingId, isStreaming: true });

      expect(id).toBe(existingId);
    });

    it('does NOT reuse a non-streaming existingMessage.id (finalized fallback)', () => {
      // When `existingMessage` is the last *finalized* assistant message (not
      // currently streaming), reusing its ID would collide with the finalized
      // entry during session-level dedup. Must mint a fresh msg_*.
      const existingId = createMessageId(`msg_${uuidv4()}`);
      const id = resolvePlaceholderId({ id: existingId, isStreaming: false });

      expect(id).not.toBe(existingId);
      expect(id).toMatch(/^msg_/);
      expect(isValidMessageId(id)).toBe(true);
    });

    it('does NOT reuse a legacy (non-msg_) existingMessage.id even if streaming', () => {
      // Persisted legacy sessions may contain non-canonical IDs. Reusing them
      // perpetuates a format the backend will never emit for new messages.
      const id = resolvePlaceholderId({ id: 'legacy-uuid-123', isStreaming: true });

      expect(id).not.toBe('legacy-uuid-123');
      expect(id).toMatch(/^msg_/);
      expect(isValidMessageId(id)).toBe(true);
    });
  });

  describe('pickPlaceholderId (stale-snapshot guard)', () => {
    // `pickPlaceholderId` lives in its own utility module (per AGENTS.md:
    // orchestration modules should not export utility functions), so a plain
    // static import is safe — no orchestration side-effects pulled in.

    it('returns the reusable ID when no current message carries it', () => {
      const reusable = createMessageId(`msg_${uuidv4()}`);
      const messages = [
        { id: createMessageId(`msg_${uuidv4()}`), role: 'user' as const } as any,
      ];

      const id = pickPlaceholderId(reusable, messages);

      expect(id).toBe(reusable);
    });

    it('mints a fresh ID when the reusable ID already exists in the current messages (finalized)', () => {
      // The snapshot said this was the streaming message's ID; since then the
      // backend finalized it and it now lives in messages with isStreaming:false.
      // Reusing it would create a second entry with the same ID → collision.
      const reusable = createMessageId(`msg_${uuidv4()}`);
      const messages = [
        { id: reusable, role: 'assistant' as const, isStreaming: false } as any,
      ];

      const id = pickPlaceholderId(reusable, messages);

      expect(id).not.toBe(reusable);
      expect(id).toMatch(/^msg_/);
      expect(isValidMessageId(id)).toBe(true);
    });

    it('mints a fresh ID when reusable is undefined', () => {
      const id = pickPlaceholderId(undefined, []);

      expect(id).toMatch(/^msg_/);
      expect(isValidMessageId(id)).toBe(true);
    });

    it('mints a fresh ID when reusable is undefined even if messages is empty', () => {
      const id1 = pickPlaceholderId(undefined, []);
      const id2 = pickPlaceholderId(undefined, []);

      expect(id1).not.toBe(id2); // always fresh
    });
  });

  describe('complete-event appMessageId adoption', () => {
    function resolveCompletedAppMessageId(
      placeholderAppMessageId: string | undefined,
      backendFinalAppMessageId: string | undefined,
      fallbackAppMessageId: string,
    ): string {
      return backendFinalAppMessageId ?? placeholderAppMessageId ?? fallbackAppMessageId;
    }

    it('prefers the backend final appMessageId over a locally-generated placeholder appMessageId', () => {
      expect(resolveCompletedAppMessageId('app_msg_placeholder', 'app_msg_backend_final', 'app_msg_fallback'))
        .toBe('app_msg_backend_final');
    });
  });
});
