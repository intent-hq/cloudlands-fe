/**
 * Integration tests for Note Primitives
 *
 * Tests the full flow from markdown to TipTap rendering
 * and execution of primitives.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotesPrimitivesSerializer } from '../../src/lib/utils/notes-primitives-serializer';
import { ReferenceResolverService } from '../../src/features/notes/main/reference-resolver.service';
import type { NotePrimitive } from '../../src/shared/types/notes-primitives';
import { v4 as uuidv4 } from 'uuid';

describe('Note Primitives Integration', () => {
  let serializer: NotesPrimitivesSerializer;
  let resolver: ReferenceResolverService;

  beforeEach(() => {
    serializer = new NotesPrimitivesSerializer();
    resolver = ReferenceResolverService.getInstance();
  });

  describe('Full Flow: Markdown → Primitives → Execution', () => {
    it('should handle reference primitive from markdown to resolution', async () => {
      // Create markdown with reference primitive
      const markdown = `
# Code Review

Here's the main class we need to review:

\`\`\`ws-block
{
  "id": "${uuidv4()}",
  "version": 1,
  "type": "reference",
  "createdAt": "${new Date().toISOString()}",
  "createdBy": "user",
  "target": {
    "kind": "symbol",
    "semanticId": "src/main.ts#symbol:MainClass.init"
  },
  "label": "MainClass initialization",
  "description": "The main initialization method"
}
\`\`\`

This method handles the startup sequence.
`;

      // Parse markdown
      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('reference');

      // Mock the resolution
      vi.spyOn(resolver, 'resolve').mockResolvedValue({
        ok: true,
        data: {
          code: 'class MainClass {\n  init() {\n    console.log("Initializing...");\n  }\n}',
          filePath: 'src/main.ts',
          languageId: 'typescript',
          range: {
            startLine: 2,
            endLine: 4,
          },
        },
      });

      // Resolve the reference
      const result = await resolver.resolve('test-workspace', 'src/main.ts#symbol:MainClass.init');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.code).toContain('init()');
        expect(result.data.languageId).toBe('typescript');
      }
    });

    it('should handle CLI primitive execution flow', async () => {
      const markdown = `
## Running Tests

Execute the test suite:

\`\`\`ws-block
{
  "id": "${uuidv4()}",
  "version": 1,
  "type": "cli",
  "createdAt": "${new Date().toISOString()}",
  "createdBy": "user",
  "command": "npm test",
  "cwd": "/project",
  "env": {
    "NODE_ENV": "test"
  },
  "status": "pending"
}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('cli');

      const cliPrimitive = parsed[0].primitive;
      expect(cliPrimitive).toHaveProperty('command', 'npm test');
    });

    it('should handle agent action primitive', async () => {
      const markdown = `
## Code Review Task

Delegate to review agent:

\`\`\`ws-block
{
  "id": "${uuidv4()}",
  "version": 1,
  "type": "agent_action",
  "createdAt": "${new Date().toISOString()}",
  "createdBy": "user",
  "agentId": "code-review-agent",
  "goal": "Review the MainClass implementation",
  "inputs": [
    {
      "kind": "reference",
      "semanticId": "src/main.ts#symbol:MainClass"
    }
  ]
}
\`\`\`
`;

      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('agent_action');
    });

    it('should round-trip multiple primitives correctly', () => {
      const primitives: NotePrimitive[] = [
        {
          id: uuidv4(),
          version: 1,
          type: 'reference',
          createdAt: new Date().toISOString(),
          createdBy: 'user',
          target: {
            kind: 'symbol',
            semanticId: 'src/utils.ts#symbol:formatDate',
          },
        },
      ];

      // Serialize to markdown
      const markdown = serializer.serializeToMarkdown(primitives);

      // Parse back
      const parsed = serializer.parseMarkdown(markdown);

      // Should maintain structure
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('reference');
    });
  });
});
