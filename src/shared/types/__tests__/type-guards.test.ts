/**
 * Tests for type guards and type restoration utilities
 */

import { describe, it, expect } from 'vitest';
import {
  restoreAgentId,
  restoreWorkspaceId,
  restoreMessageId,
  restoreStreamId,
  restoreSessionId,
  restoreToolCallId,
  isAgentId,
  isWorkspaceId,
  isMessageId,
  isStreamId,
  isSessionId,
  isToolCallId,
  restoreBrandedIds,
} from '../type-guards';

// Valid UUIDs for testing
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '72a6342c-bd9b-4d9b-939e-9ed2af6da3ca';

describe('type-guards', () => {
  describe('restore functions', () => {
    it('restoreAgentId should return undefined for null/undefined', () => {
      expect(restoreAgentId(null)).toBeUndefined();
      expect(restoreAgentId(undefined)).toBeUndefined();
    });

    it('restoreAgentId should restore valid agent ID (UUID)', () => {
      const result = restoreAgentId(VALID_UUID);
      expect(result).toBe(VALID_UUID);
    });

    it('restoreAgentId should restore valid agent ID (agent- prefix)', () => {
      const result = restoreAgentId('agent-123');
      expect(result).toBe('agent-123');
    });

    it('restoreWorkspaceId should return undefined for null/undefined', () => {
      expect(restoreWorkspaceId(null)).toBeUndefined();
      expect(restoreWorkspaceId(undefined)).toBeUndefined();
    });

    it('restoreWorkspaceId should restore valid workspace ID (UUID)', () => {
      const result = restoreWorkspaceId(VALID_UUID);
      expect(result).toBe(VALID_UUID);
    });

    it('restoreMessageId should restore valid message ID', () => {
      const result = restoreMessageId('msg_123');
      expect(result).toBe('msg_123');
    });

    it('restoreStreamId should restore valid stream ID', () => {
      const result = restoreStreamId('stream_123');
      expect(result).toBe('stream_123');
    });

    it('restoreSessionId should restore valid session ID', () => {
      const result = restoreSessionId('sess_123');
      expect(result).toBe('sess_123');
    });

    it('restoreToolCallId should restore valid tool call ID', () => {
      const result = restoreToolCallId('tool_123');
      expect(result).toBe('tool_123');
    });
  });

  describe('type guard functions', () => {
    // Note: The type guards in type-guards.ts use different prefixes than the actual validation
    // These tests verify the type guard behavior as implemented
    it('isAgentId should detect agent_ prefix', () => {
      expect(isAgentId('agent_123')).toBe(true);
      expect(isAgentId('workspace_123')).toBe(false);
      expect(isAgentId(123)).toBe(false);
    });

    it('isWorkspaceId should detect workspace_ prefix', () => {
      expect(isWorkspaceId('workspace_123')).toBe(true);
      expect(isWorkspaceId('agent_123')).toBe(false);
    });

    it('isMessageId should detect msg_ prefix', () => {
      expect(isMessageId('msg_123')).toBe(true);
      expect(isMessageId('agent_123')).toBe(false);
    });

    it('isStreamId should detect stream_ prefix', () => {
      expect(isStreamId('stream_123')).toBe(true);
      expect(isStreamId('agent_123')).toBe(false);
    });

    it('isSessionId should detect session_ prefix', () => {
      expect(isSessionId('session_123')).toBe(true);
      expect(isSessionId('agent_123')).toBe(false);
    });

    it('isToolCallId should detect tool_ prefix', () => {
      expect(isToolCallId('tool_123')).toBe(true);
      expect(isToolCallId('agent_123')).toBe(false);
    });
  });

  describe('restoreBrandedIds', () => {
    it('should restore agentId field (UUID)', () => {
      const obj = { agentId: VALID_UUID, name: 'Test' };
      const result = restoreBrandedIds(obj);
      expect(result.agentId).toBe(VALID_UUID);
      expect(result.name).toBe('Test');
    });

    it('should restore workspaceId field (UUID)', () => {
      const obj = { workspaceId: VALID_UUID };
      const result = restoreBrandedIds(obj);
      expect(result.workspaceId).toBe(VALID_UUID);
    });

    it('should restore sessionId field', () => {
      const obj = { sessionId: 'sess_123' };
      const result = restoreBrandedIds(obj);
      expect(result.sessionId).toBe('sess_123');
    });

    it('should restore id field based on prefix', () => {
      // msg_ prefix triggers isMessageId type guard
      const msgObj = { id: 'msg_123' };
      expect(restoreBrandedIds(msgObj).id).toBe('msg_123');

      // stream_ prefix triggers isStreamId type guard
      const streamObj = { id: 'stream_123' };
      expect(restoreBrandedIds(streamObj).id).toBe('stream_123');
    });

    it('should not modify non-ID fields', () => {
      const obj = { name: 'Test', count: 5 };
      const result = restoreBrandedIds(obj);
      expect(result.name).toBe('Test');
      expect(result.count).toBe(5);
    });
  });
});
