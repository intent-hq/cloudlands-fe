/**
 * Tests for agent assignment schema validation
 * Phase 1C - Increment 1: Agent Assignment Data Model
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { TaskMetadataSchema } from '$shared/schemas';
import { createAgentId } from '$shared/types/branded-ids';

describe('Agent Assignment Schema', () => {
  describe('TaskMetadata.assignedAgentIds', () => {
    it('should accept empty array', () => {
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        assignedAgentIds: [],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedAgentIds).toEqual([]);
      }
    });

    it('should accept array with single agent ID', () => {
      const agentId = createAgentId(uuidv4());
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        assignedAgentIds: [agentId],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedAgentIds).toEqual([agentId]);
      }
    });

    it('should accept array with multiple agent IDs', () => {
      const agentId1 = createAgentId(uuidv4());
      const agentId2 = createAgentId(uuidv4());
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        assignedAgentIds: [agentId1, agentId2],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedAgentIds).toEqual([agentId1, agentId2]);
      }
    });

    it('should accept undefined (optional field)', () => {
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedAgentIds).toBeUndefined();
      }
    });

    it('should reject non-array values', () => {
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        assignedAgentIds: 'not-an-array',
      });

      expect(result.success).toBe(false);
    });

    it('should reject array with non-string values', () => {
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        assignedAgentIds: [123, 456],
      });

      expect(result.success).toBe(false);
    });

    it('should allow duplicate agent IDs', () => {
      const agentId = createAgentId(uuidv4());
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        assignedAgentIds: [agentId, agentId],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.assignedAgentIds).toEqual([agentId, agentId]);
      }
    });
  });

  describe('TaskMetadata without agentHistory', () => {
    it('should not have agentHistory field in schema', () => {
      const result = TaskMetadataSchema.safeParse({
        status: 'not_started',
        agentHistory: [],
      });

      // The schema should either reject agentHistory or strip it
      // We'll verify this after updating the schema
      expect(result.success).toBe(true);
      if (result.success) {
        // After cleanup, agentHistory should not be present
        expect('agentHistory' in result.data).toBe(false);
      }
    });
  });
});
