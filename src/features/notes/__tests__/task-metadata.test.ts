/**
 * Tests for Task Metadata Types and Schemas
 * Phase 1A - Increment 1
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import type { TaskMetadata, TaskStatus, AgentHistoryEntry } from '../../../shared/types';
import {
  TaskMetadataSchema,
  TaskStatusSchema,
} from '../../../shared/schemas';

describe('TaskMetadata types', () => {
  it('should accept valid task metadata', () => {
    const metadata: TaskMetadata = {
      status: 'not_started',
    };
    expect(metadata).toBeDefined();
    expect(metadata.status).toBe('not_started');
  });

  it('should accept all valid status values', () => {
    const statuses: TaskStatus[] = [
      'not_started',
      'waiting',
      'discussion_needed',
      'in_progress',
      'review_required',
      'complete',
      'cancelled',
    ];

    statuses.forEach((status) => {
      const metadata: TaskMetadata = { status };
      expect(metadata.status).toBe(status);
    });
  });

  it('should accept optional fields', () => {
    const metadata: TaskMetadata = {
      status: 'in_progress',
      assignedAgentIds: ['agent-1', 'agent-2'],
      acceptanceCriteria: ['Criterion 1', 'Criterion 2'],
      estimatedEffort: '2 hours',
      actualEffort: '3 hours',
      blockedReason: 'Waiting on dependency',
      startedAt: '2024-01-01T00:00:00Z',
    };

    expect(metadata.assignedAgentIds).toHaveLength(2);
    expect(metadata.acceptanceCriteria).toHaveLength(2);
  });

  it('should accept agent history', () => {
    const history: AgentHistoryEntry[] = [
      {
        agentId: 'agent-1',
        assignedAt: '2024-01-01T00:00:00Z',
        unassignedAt: '2024-01-01T01:00:00Z',
        outcome: 'completed',
      },
      {
        agentId: 'agent-2',
        assignedAt: '2024-01-01T02:00:00Z',
        outcome: 'abandoned',
      },
    ];

    const metadata: TaskMetadata = {
      status: 'complete',
      agentHistory: history,
    };

    expect(metadata.agentHistory).toHaveLength(2);
    expect(metadata.agentHistory?.[0].outcome).toBe('completed');
  });
});

describe('TaskMetadataSchema', () => {
  it('should validate valid task metadata', () => {
    const metadata = {
      status: 'not_started',
    };

    const result = TaskMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
  });

  it('should reject invalid status', () => {
    const metadata = {
      status: 'invalid_status',
    };

    const result = TaskMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(false);
  });

  it('should validate agent history', () => {
    const metadata = {
      status: 'complete',
      agentHistory: [
        {
          agentId: 'agent-1',
          assignedAt: '2024-01-01T00:00:00Z',
          unassignedAt: '2024-01-01T01:00:00Z',
          outcome: 'completed',
        },
      ],
    };

    const result = TaskMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
  });

  it('should allow optional fields to be omitted', () => {
    const metadata = {
      status: 'not_started',
    };

    const result = TaskMetadataSchema.safeParse(metadata);
    expect(result.success).toBe(true);
  });
});

describe('TaskStatusSchema', () => {
  it('should validate all valid statuses', () => {
    const statuses = [
      'not_started',
      'waiting',
      'discussion_needed',
      'in_progress',
      'review_required',
      'complete',
      'cancelled',
    ];

    statuses.forEach((status) => {
      const result = TaskStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    });
  });

  it('should reject invalid status', () => {
    const result = TaskStatusSchema.safeParse('invalid');
    expect(result.success).toBe(false);
  });

  it('should reject removed legacy statuses', () => {
    const legacyStatuses = ['proposed', 'ready'];
    legacyStatuses.forEach((status) => {
      const result = TaskStatusSchema.safeParse(status);
      expect(result.success).toBe(false);
    });
  });
});
