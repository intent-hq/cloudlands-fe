/**
 * Tests for notes primitives serializer
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import { NotesPrimitivesSerializer } from '../notes-primitives-serializer';
import type {
  ReferencePrimitive,
  CliPrimitive,
  AgentActionPrimitive,
  PatchPrimitive,
} from '$shared/types/notes-primitives';
import { v4 as uuidv4 } from 'uuid';

describe('NotesPrimitivesSerializer', () => {
  let serializer: NotesPrimitivesSerializer;

  beforeEach(() => {
    serializer = new NotesPrimitivesSerializer();
  });

  // Helper to create valid test primitives with all required fields
  // Matching the actual schema from src/shared/types/notes-primitives.ts
  const createValidPrimitive = (type: string, data: any = {}) => {
    const base = {
      id: data.id || uuidv4(),
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: 'user' as const,
    };

    // Add type-specific required fields
    // Put type first for discriminated union validation
    switch (type) {
      case 'reference': {
        // ReferencePrimitive has target field with nested semanticId
        const target = {
          kind: 'symbol' as const,
          semanticId: data.semanticId || 'src/main.ts#symbol:MainClass',
          ...(data.filePath && { filePath: data.filePath }),
          ...(data.languageId && { languageId: data.languageId }),
        };
        const snapshot = data.snapshot || {
          code: data.content || 'code',
          filePath: data.filePath || 'src/main.ts',
          languageId: data.languageId || 'typescript',
        };
        return {
          type: 'reference' as const,
          ...base,
          target,
          ...(snapshot && { snapshot }),
          ...(data.display && { display: data.display }),
          ...(data.label && { label: data.label }),
          ...(data.description && { description: data.description }),
          ...(data.meta && { meta: data.meta }),
        };
      }
      case 'cli':
        return {
          type: 'cli' as const,
          ...base,
          command: data.command || 'ls',
          ...(data.cwd && { cwd: data.cwd }),
          ...(data.env && { env: data.env }),
          ...(data.timeoutMs && { timeoutMs: data.timeoutMs }),
          ...(data.lastRun && { lastRun: data.lastRun }),
          ...(data.outputSnapshot && { outputSnapshot: data.outputSnapshot }),
          ...(data.display && { display: data.display }),
          ...(data.label && { label: data.label }),
          ...(data.description && { description: data.description }),
          ...(data.meta && { meta: data.meta }),
        };
      case 'agent_action':
        // AgentActionPrimitive has goal and inputs instead of action/parameters
        return {
          type: 'agent_action' as const,
          ...base,
          agentId: data.agentId || 'agent-1',
          goal: data.goal || data.action || 'test goal',
          inputs:
            data.inputs ||
            data.parameters?.map((p: any) => ({
              kind: 'text',
              content: p.value || p.name,
            })) ||
            [],
          ...(data.config && { config: data.config }),
          ...(data.lastRun && { lastRun: data.lastRun }),
          ...(data.resultSummary && { resultSummary: data.resultSummary }),
          ...(data.label && { label: data.label }),
          ...(data.description && { description: data.description }),
          ...(data.meta && { meta: data.meta }),
        };
      case 'patch':
        return {
          type: 'patch' as const,
          ...base,
          patches: data.patches || [],
          ...(data.lastApply && { lastApply: data.lastApply }),
          ...(data.display && { display: data.display }),
          ...(data.label && { label: data.label }),
          ...(data.description && { description: data.description }),
          ...(data.meta && { meta: data.meta }),
        };
      default:
        return base;
    }
  };

  describe('parseMarkdown', () => {
    it('should parse reference primitives from markdown', () => {
      const refPrimitive = createValidPrimitive('reference', {
        semanticId: 'src/main.ts#symbol:MainClass',
        content: 'class MainClass {}',
        languageId: 'typescript',
      });

      const markdown = `
# My Note

Here's some code:

\`\`\`ws-block
${JSON.stringify(refPrimitive, null, 2)}
\`\`\`

More text here.
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('reference');
      expect(parsed[0].primitive.id).toBeDefined();
      expect((parsed[0].primitive as ReferencePrimitive).target.semanticId).toBe(
        'src/main.ts#symbol:MainClass',
      );
    });

    it('should parse CLI primitives from markdown', () => {
      const cliPrimitive = createValidPrimitive('cli', {
        command: 'npm test',
        cwd: '/project',
        output: 'Tests passed',
        exitCode: 0,
        status: 'completed',
      });

      const markdown = `
\`\`\`ws-block
${JSON.stringify(cliPrimitive, null, 2)}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('cli');
      expect((parsed[0].primitive as CliPrimitive).command).toBe('npm test');
    });

    it('should parse agent action primitives from markdown', () => {
      const agentPrimitive = createValidPrimitive('agent_action', {
        agentId: 'code-review',
        goal: 'Review this code',
        inputs: [{ kind: 'text', content: 'Review this code' }],
      });

      const markdown = `
\`\`\`ws-block
${JSON.stringify(agentPrimitive, null, 2)}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('agent_action');
      expect((parsed[0].primitive as AgentActionPrimitive).agentId).toBe('code-review');
      expect((parsed[0].primitive as AgentActionPrimitive).goal).toBe('Review this code');
    });

    it('should parse patch primitives from markdown', () => {
      const patchPrimitive = createValidPrimitive('patch', {
        patches: [
          {
            filePath: 'src/main.ts',
            diff: '--- a/src/main.ts\\n+++ b/src/main.ts\\n@@ -1,1 +1,1 @@\\n-old\\n+new',
            status: 'pending',
          },
        ],
      });

      const markdown = `
\`\`\`ws-block
${JSON.stringify(patchPrimitive, null, 2)}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('patch');
      expect((parsed[0].primitive as PatchPrimitive).patches).toHaveLength(1);
    });

    it('should parse multiple primitives from markdown', () => {
      const refPrimitive = createValidPrimitive('reference', {
        semanticId: 'src/main.ts#L10',
        content: 'code',
        languageId: 'typescript',
      });

      const cliPrimitive = createValidPrimitive('cli', {
        command: 'ls -la',
        status: 'pending',
      });

      const markdown = `
# Document

\`\`\`ws-block
${JSON.stringify(refPrimitive, null, 2)}
\`\`\`

Some text between blocks.

\`\`\`ws-block
${JSON.stringify(cliPrimitive, null, 2)}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].primitive.type).toBe('reference');
      expect(parsed[1].primitive.type).toBe('cli');
    });

    it('should skip invalid ws-blocks', () => {
      const refPrimitive = createValidPrimitive('reference', {
        semanticId: 'src/main.ts#L10',
        content: 'code',
        languageId: 'typescript',
      });

      const markdown = `
\`\`\`ws-block
invalid json
\`\`\`

\`\`\`ws-block
${JSON.stringify(refPrimitive, null, 2)}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1); // Only valid block parsed
      expect(parsed[0].primitive.id).toBeDefined();
    });

    it('should handle empty markdown', () => {
      const primitives = serializer.parseMarkdown('');
      expect(primitives).toHaveLength(0);
    });

    it('should handle markdown without ws-blocks', () => {
      const markdown = `
# Regular Markdown

Just some text without any ws-blocks.

\`\`\`javascript
// Regular code block
console.log('hello');
\`\`\`
`;

      const primitives = serializer.parseMarkdown(markdown);
      expect(primitives).toHaveLength(0);
    });
  });

  describe('serializeToMarkdown', () => {
    it('should serialize primitives to markdown', () => {
      const refId = uuidv4();
      const cliId = uuidv4();
      const primitives = [
        createValidPrimitive('reference', {
          id: refId,
          semanticId: 'src/main.ts#L10',
          content: 'const x = 1;',
          languageId: 'typescript',
        }),
        createValidPrimitive('cli', {
          id: cliId,
          command: 'npm test',
          status: 'pending',
        }),
      ];

      const markdown = serializer.serializeToMarkdown(primitives);

      expect(markdown).toContain('```ws-block');
      expect(markdown).toContain(`"id": "${refId}"`);
      expect(markdown).toContain('"type": "reference"');
      expect(markdown).toContain(`"id": "${cliId}"`);
      expect(markdown).toContain('"type": "cli"');
    });

    it('should preserve existing content when serializing', () => {
      const existingContent = `
# My Document

Some important text here.

<!-- Primitives will be inserted below -->
`;

      const refId = uuidv4();
      const primitives = [
        createValidPrimitive('reference', {
          id: refId,
          semanticId: 'src/main.ts#L10',
          content: 'code',
          languageId: 'typescript',
        }),
      ];

      const markdown = serializer.serializeToMarkdown(primitives, existingContent);

      expect(markdown).toContain('# My Document');
      expect(markdown).toContain('Some important text here');
      expect(markdown).toContain('```ws-block');
      expect(markdown).toContain(`"id": "${refId}"`);
    });

    it('should replace existing ws-blocks when serializing', () => {
      const oldId = uuidv4();
      const oldPrimitive = createValidPrimitive('reference', {
        id: oldId,
        semanticId: 'old.ts#L1',
        content: 'old',
        languageId: 'typescript',
      });

      const existingContent = `
# Document

Text before.

\`\`\`ws-block
${JSON.stringify(oldPrimitive, null, 2)}
\`\`\`

Text after.
`;

      const newId = uuidv4();
      const primitives = [
        createValidPrimitive('reference', {
          id: newId,
          semanticId: 'new.ts#L1',
          content: 'new',
          languageId: 'typescript',
        }),
      ];

      const markdown = serializer.serializeToMarkdown(primitives, existingContent);

      expect(markdown).toContain('Text before');
      expect(markdown).toContain('Text after');
      expect(markdown).toContain(`"id": "${newId}"`);
      expect(markdown).not.toContain(`"id": "${oldId}"`);
    });

    it('should handle empty primitives array', () => {
      const markdown = serializer.serializeToMarkdown([]);
      expect(markdown).toBe('');
    });

    it('should format JSON with proper indentation', () => {
      const refId = uuidv4();
      const primitives = [
        {
          id: refId,
          version: 1,
          createdAt: new Date().toISOString(),
          createdBy: 'user' as const,
          type: 'reference' as const,
          semanticId: 'src/main.ts#L10',
          content: 'code',
          languageId: 'typescript',
          snapshot: {
            content: 'code',
            timestamp: new Date().toISOString(),
            hash: 'abc123',
          },
        },
      ];

      const markdown = serializer.serializeToMarkdown(primitives);

      // Check for proper indentation
      expect(markdown).toMatch(/  "id": "/);
      expect(markdown).toMatch(/  "type": "reference"/);
    });
  });

  describe('Round-trip serialization', () => {
    it('should preserve primitives through parse and serialize', () => {
      const refId = uuidv4();
      const cliId = uuidv4();
      const originalPrimitives = [
        createValidPrimitive('reference', {
          id: refId,
          semanticId: 'src/main.ts#symbol:MainClass',
          content: 'class MainClass {}',
          languageId: 'typescript',
        }),
        createValidPrimitive('cli', {
          id: cliId,
          command: 'npm test',
          cwd: '/project',
          env: { NODE_ENV: 'test' },
          outputSnapshot: {
            stdout: 'Tests passed',
            stderr: '',
          },
        }),
      ];

      // Serialize to markdown
      const markdown = serializer.serializeToMarkdown(originalPrimitives);

      // Parse back
      const parsed = serializer.parseMarkdown(markdown);

      // Should have same length
      expect(parsed).toHaveLength(originalPrimitives.length);

      // Check key fields match
      expect(parsed[0].primitive.id).toBe(refId);
      expect(parsed[0].primitive.type).toBe('reference');
      expect((parsed[0].primitive as ReferencePrimitive).target.semanticId).toBe(
        'src/main.ts#symbol:MainClass',
      );

      expect(parsed[1].primitive.id).toBe(cliId);
      expect(parsed[1].primitive.type).toBe('cli');
      expect((parsed[1].primitive as CliPrimitive).command).toBe('npm test');
    });
  });
});
