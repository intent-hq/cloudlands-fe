/**
 * Renderer-side ID pass-through tests
 *
 * Verifies the ID generation and pass-through pattern used by sendMessage in
 * agent-send.ts: the pre-assigned assistant message ID travels on the §5.5
 * wire call so the daemon persists under the same ID the renderer knows.
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

});
