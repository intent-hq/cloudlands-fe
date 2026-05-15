/**
 * Tests for First Visit State IPC validation schemas
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  FirstVisitStateLoadSchema,
  FirstVisitStateSaveSchema,
  FirstVisitStateDeleteSchema,
  FirstVisitStateExistsSchema,
} from '../../../../main/ipc-schemas';

describe('FirstVisitState IPC Validation Schemas', () => {
  // Valid formats:
  // - New slug format: word-word (e.g., "amber-forest")
  // - New slug with numeric suffix: word-word-N (e.g., "amber-forest-2")
  // - Legacy slug format: word-word-xxxx (e.g., "amber-forest-a7x2")
  // - UUID
  const validUuid = '123e4567-e89b-42d3-a456-426614174000'; // Valid v4 UUID
  const validSlug = 'amber-forest-a7x2'; // Valid legacy slug format
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const validNewSlug = 'amber-forest'; // Valid new slug format (no suffix)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const validNewSlugWithSuffix = 'amber-forest-2'; // Valid new slug format (numeric suffix)
  // Invalid: single word (needs at least 2 parts)
  const invalidId = 'invalid';

  describe('FirstVisitStateLoadSchema', () => {
    it('should accept valid UUID workspaceId', () => {
      const result = FirstVisitStateLoadSchema.safeParse({
        workspaceId: validUuid,
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid slug workspaceId', () => {
      const result = FirstVisitStateLoadSchema.safeParse({
        workspaceId: validSlug,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid workspaceId', () => {
      const result = FirstVisitStateLoadSchema.safeParse({
        workspaceId: invalidId,
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing workspaceId', () => {
      const result = FirstVisitStateLoadSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('FirstVisitStateSaveSchema', () => {
    const validState = {
      version: 1,
      workspaceId: validUuid,
      firstVisitSetupReady: true,
      mainContentRevealed: false,
      navigationRailRevealed: true,
      workspaceDockRevealed: false,
      lastUpdated: '2025-11-20T12:00:00Z',
    };

    it('should accept valid data with UUID', () => {
      const result = FirstVisitStateSaveSchema.safeParse({
        workspaceId: validUuid,
        state: validState,
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid data with slug', () => {
      const stateWithSlug = { ...validState, workspaceId: validSlug };
      const result = FirstVisitStateSaveSchema.safeParse({
        workspaceId: validSlug,
        state: stateWithSlug,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid workspaceId', () => {
      const result = FirstVisitStateSaveSchema.safeParse({
        workspaceId: invalidId,
        state: validState,
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing required state fields', () => {
      const incompleteState = {
        version: 1,
        workspaceId: validUuid,
        // Missing required boolean fields and lastUpdated
      };
      const result = FirstVisitStateSaveSchema.safeParse({
        workspaceId: validUuid,
        state: incompleteState,
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing lastUpdated field', () => {
      const stateWithoutLastUpdated = {
        version: 1,
        workspaceId: validUuid,
        firstVisitSetupReady: true,
        mainContentRevealed: false,
        navigationRailRevealed: true,
        workspaceDockRevealed: false,
        // Missing lastUpdated
      };
      const result = FirstVisitStateSaveSchema.safeParse({
        workspaceId: validUuid,
        state: stateWithoutLastUpdated,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('FirstVisitStateDeleteSchema', () => {
    it('should accept valid UUID workspaceId', () => {
      const result = FirstVisitStateDeleteSchema.safeParse({
        workspaceId: validUuid,
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid slug workspaceId', () => {
      const result = FirstVisitStateDeleteSchema.safeParse({
        workspaceId: validSlug,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid workspaceId', () => {
      const result = FirstVisitStateDeleteSchema.safeParse({
        workspaceId: invalidId,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('FirstVisitStateExistsSchema', () => {
    it('should accept valid UUID workspaceId', () => {
      const result = FirstVisitStateExistsSchema.safeParse({
        workspaceId: validUuid,
      });
      expect(result.success).toBe(true);
    });

    it('should accept valid slug workspaceId', () => {
      const result = FirstVisitStateExistsSchema.safeParse({
        workspaceId: validSlug,
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid workspaceId', () => {
      const result = FirstVisitStateExistsSchema.safeParse({
        workspaceId: invalidId,
      });
      expect(result.success).toBe(false);
    });
  });
});
