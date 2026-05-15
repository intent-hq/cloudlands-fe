/**
 * Tests for Branded IDs Migration Helpers
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import * as Migration from '../branded-ids.migration';
import * as BrandedIds from '../branded-ids';
import { v4 as uuidv4 } from 'uuid';

describe('Branded IDs Migration', () => {
  describe('migrateToBrandedIds', () => {
    it('should migrate id field', () => {
      const uuid = uuidv4();
      const data = { id: uuid };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidAgentId(migrated.id)).toBe(true);
    });

    it('should migrate agentId field', () => {
      const uuid = uuidv4();
      const data = { agentId: uuid };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidAgentId(migrated.agentId)).toBe(true);
    });

    it('should migrate sessionId field', () => {
      const uuid = uuidv4();
      const sessionId = `sess_${uuid}`;
      const data = { sessionId };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidSessionId(migrated.sessionId)).toBe(true);
    });

    it('should migrate messageId field', () => {
      const uuid = uuidv4();
      const messageId = `msg_${uuid}`;
      const data = { messageId };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidMessageId(migrated.messageId)).toBe(true);
    });

    it('should migrate workspaceId field', () => {
      const uuid = uuidv4();
      const data = { workspaceId: uuid };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidWorkspaceId(migrated.workspaceId)).toBe(true);
    });

    it('should migrate streamId field', () => {
      const uuid = uuidv4();
      const streamId = `stream_${uuid}`;
      const data = { streamId };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidStreamId(migrated.streamId)).toBe(true);
    });

    it('should migrate multiple ID fields', () => {
      const uuid1 = uuidv4();
      const uuid2 = uuidv4();
      const data = {
        id: uuid1,
        agentId: uuid2,
        sessionId: `sess_${uuidv4()}`,
      };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(BrandedIds.isValidAgentId(migrated.id)).toBe(true);
      expect(BrandedIds.isValidAgentId(migrated.agentId)).toBe(true);
      expect(BrandedIds.isValidSessionId(migrated.sessionId)).toBe(true);
    });

    it('should preserve non-ID fields', () => {
      const data = {
        id: uuidv4(),
        name: 'test',
        count: 42,
        active: true,
      };
      const migrated = Migration.migrateToBrandedIds(data);
      expect(migrated.name).toBe('test');
      expect(migrated.count).toBe(42);
      expect(migrated.active).toBe(true);
    });

    it('should handle null and undefined', () => {
      expect(Migration.migrateToBrandedIds(null)).toBe(null);
      expect(Migration.migrateToBrandedIds(undefined)).toBe(undefined);
    });
  });

  describe('migrateToBrandedIdsArray', () => {
    it('should migrate array of objects', () => {
      const data = [{ id: uuidv4() }, { id: uuidv4() }, { id: uuidv4() }];
      const migrated = Migration.migrateToBrandedIdsArray(data);
      expect(migrated).toHaveLength(3);
      migrated.forEach((item) => {
        expect(BrandedIds.isValidAgentId(item.id)).toBe(true);
      });
    });

    it('should handle empty array', () => {
      const migrated = Migration.migrateToBrandedIdsArray([]);
      expect(migrated).toHaveLength(0);
    });
  });

  describe('migrateToBrandedIdsDeep', () => {
    it('should migrate nested messages array', () => {
      const data = {
        id: uuidv4(),
        messages: [{ id: `msg_${uuidv4()}` }, { id: `msg_${uuidv4()}` }],
      };
      const migrated = Migration.migrateToBrandedIdsDeep(data);
      expect(BrandedIds.isValidAgentId(migrated.id)).toBe(true);
      migrated.messages.forEach((msg: any) => {
        expect(BrandedIds.isValidMessageId(msg.id)).toBe(true);
      });
    });

    it('should migrate nested agents array', () => {
      const data = {
        id: uuidv4(),
        agents: [{ id: uuidv4() }, { id: uuidv4() }],
      };
      const migrated = Migration.migrateToBrandedIdsDeep(data);
      migrated.agents.forEach((agent: any) => {
        expect(BrandedIds.isValidAgentId(agent.id)).toBe(true);
      });
    });

    it('should migrate nested sessions array', () => {
      const data = {
        id: uuidv4(),
        sessions: [{ sessionId: `sess_${uuidv4()}` }, { sessionId: `sess_${uuidv4()}` }],
      };
      const migrated = Migration.migrateToBrandedIdsDeep(data);
      migrated.sessions.forEach((session: any) => {
        expect(BrandedIds.isValidSessionId(session.sessionId)).toBe(true);
      });
    });
  });

  describe('validateBrandedIds', () => {
    it('should validate object with valid IDs', () => {
      const data = {
        id: uuidv4(),
        agentId: uuidv4(),
        sessionId: `sess_${uuidv4()}`,
      };
      expect(Migration.validateBrandedIds(data)).toBe(true);
    });

    it('should reject object with invalid IDs', () => {
      const data = {
        id: 'invalid',
      };
      expect(Migration.validateBrandedIds(data)).toBe(false);
    });

    it('should handle objects without ID fields', () => {
      const data = {
        name: 'test',
        count: 42,
      };
      expect(Migration.validateBrandedIds(data)).toBe(true);
    });
  });
});
