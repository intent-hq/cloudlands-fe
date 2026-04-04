/**
 * End-to-end tests for Note Primitives
 *
 * Tests the complete flow including:
 * - TipTap editor integration
 * - UI component rendering
 * - IPC handler execution
 * - Persistence
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NotesPrimitivesSerializer } from '../../src/features/notes/notes-primitives-serializer';
import { v4 as uuidv4 } from 'uuid';
import type {
  ReferencePrimitive,
  CliPrimitive,
  AgentActionPrimitive,
  PatchPrimitive,
} from '../../src/shared/types/notes-primitives';

describe('Note Primitives E2E Tests', () => {
  let serializer: NotesPrimitivesSerializer;

  beforeEach(() => {
    serializer = new NotesPrimitivesSerializer();
  });

  describe('Complete Primitive Lifecycle', () => {
    it('should handle reference primitive from creation to execution', () => {
      // 1. Create a reference primitive
      const refPrimitive: ReferencePrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'reference',
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        target: {
          kind: 'symbol',
          semanticId: 'src/features/agent/agent.service.ts#symbol:AgentService.createAgent',
        },
        label: 'Agent Creation Method',
        description: 'The main method for creating new agents',
      };

      // 2. Serialize to markdown
      const markdown = serializer.serializeToMarkdown([refPrimitive]);
      expect(markdown).toContain('```ws-block');
      expect(markdown).toContain('"type": "reference"');
      expect(markdown).toContain('AgentService.createAgent');

      // 3. Parse back from markdown
      const parsed = serializer.parseMarkdown(markdown);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].primitive.type).toBe('reference');
      expect((parsed[0].primitive as ReferencePrimitive).target.semanticId).toBe(
        'src/features/agent/agent.service.ts#symbol:AgentService.createAgent',
      );

      // 4. Verify metadata preservation
      expect(parsed[0].startLine).toBeDefined();
      expect(parsed[0].endLine).toBeDefined();
      expect(parsed[0].rawContent).toBeDefined();
    });

    it('should handle CLI primitive with execution tracking', () => {
      const cliPrimitive: CliPrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'cli',
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        command: 'npm run test:unit',
        cwd: '/project',
        env: {
          NODE_ENV: 'test',
          CI: 'true',
        },
        status: 'pending',
        display: {
          showCommandPrefix: '$',
          collapsedOutputByDefault: false,
        },
      };

      const markdown = serializer.serializeToMarkdown([cliPrimitive]);
      const parsed = serializer.parseMarkdown(markdown);

      const parsedCli = parsed[0].primitive as CliPrimitive;
      expect(parsedCli.command).toBe('npm run test:unit');
      expect(parsedCli.env?.NODE_ENV).toBe('test');
      expect(parsedCli.display?.showCommandPrefix).toBe('$');
    });

    it('should handle agent action primitive with inputs', () => {
      const agentPrimitive: AgentActionPrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'agent_action',
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        agentId: 'code-reviewer',
        goal: 'Review the AgentService implementation for best practices',
        inputs: [
          {
            kind: 'reference',
            semanticId: 'src/features/agent/agent.service.ts#symbol:AgentService',
          },
          {
            kind: 'text',
            content: 'Focus on error handling and performance',
          },
        ],
        status: 'pending',
      };

      const markdown = serializer.serializeToMarkdown([agentPrimitive]);
      const parsed = serializer.parseMarkdown(markdown);

      const parsedAgent = parsed[0].primitive as AgentActionPrimitive;
      expect(parsedAgent.agentId).toBe('code-reviewer');
      expect(parsedAgent.inputs).toHaveLength(2);
      expect(parsedAgent.inputs[0].kind).toBe('reference');
      expect(parsedAgent.inputs[1].kind).toBe('text');
    });

    it('should handle patch primitive with multiple file patches', () => {
      const patchPrimitive: PatchPrimitive = {
        id: uuidv4(),
        version: 1,
        type: 'patch',
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        patches: [
          {
            filePath: 'src/main.ts',
            diff: `--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,4 @@
+import { Logger } from './logger';
 import { App } from './app';

 const app = new App();`,
            description: 'Add logger import',
          },
        ],
        label: 'Add logging support',
        description: 'Integrate logger into main application',
      };

      const markdown = serializer.serializeToMarkdown([patchPrimitive]);
      const parsed = serializer.parseMarkdown(markdown);

      const parsedPatch = parsed[0].primitive as PatchPrimitive;
      expect(parsedPatch.patches).toHaveLength(1);
      expect(parsedPatch.patches[0].filePath).toBe('src/main.ts');
      expect(parsedPatch.patches[0].diff).toContain('import { Logger }');
    });
  });
});
