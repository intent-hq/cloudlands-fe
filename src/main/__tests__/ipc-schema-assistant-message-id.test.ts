/**
 * IPC Schema Validation — assistantMessageId field on AgentBackendStreamMessageSchema
 *
 * Verifies:
 * - Accepts payloads with assistantMessageId: 'msg_<uuid>'
 * - Rejects payloads where assistantMessageId is a non-`msg_`-prefixed string
 * - Accepts payloads without assistantMessageId (field is optional)
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { AgentBackendStreamMessageSchema } from '../ipc-schemas';
import { v4 as uuidv4 } from 'uuid';

function makeBasePayload(overrides: Record<string, unknown> = {}) {
  return {
    agentId: `agent-${uuidv4()}`,
    sessionId: `agent-${uuidv4()}`,
    content: 'Hello world',
    workspaceId: uuidv4(),
    ...overrides,
  };
}

describe('AgentBackendStreamMessageSchema — assistantMessageId', () => {
  it('accepts a payload with a msg_-prefixed assistantMessageId', () => {
    const payload = makeBasePayload({
      assistantMessageId: `msg_${uuidv4()}`,
    });
    const result = AgentBackendStreamMessageSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assistantMessageId).toBe(payload.assistantMessageId);
    }
  });

  it('rejects a payload where assistantMessageId lacks the msg_ prefix', () => {
    const payload = makeBasePayload({
      assistantMessageId: uuidv4(), // bare UUID without msg_ prefix
    });
    const result = AgentBackendStreamMessageSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a payload where assistantMessageId is an arbitrary string', () => {
    const payload = makeBasePayload({
      assistantMessageId: 'some-random-id',
    });
    const result = AgentBackendStreamMessageSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a payload where assistantMessageId has msg_ prefix but not a valid UUID', () => {
    const payload = makeBasePayload({
      assistantMessageId: 'msg_not-a-uuid',
    });
    const result = AgentBackendStreamMessageSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('rejects a payload where assistantMessageId has msg_ prefix with trailing garbage', () => {
    const payload = makeBasePayload({
      assistantMessageId: `msg_${uuidv4()}extra`,
    });
    const result = AgentBackendStreamMessageSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it('accepts a payload without assistantMessageId (field is optional)', () => {
    const payload = makeBasePayload();
    const result = AgentBackendStreamMessageSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assistantMessageId).toBeUndefined();
    }
  });
});
