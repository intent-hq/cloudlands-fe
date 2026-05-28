/**
 * Round-trip serialization tests for note primitives (ws-blocks)
 *
 * Tests that primitives survive the full round-trip:
 * 1. Create primitive → Serialize to markdown → Parse back
 * 2. Parse from markdown → Convert to TipTap → Update via button → Serialize back
 *
 * Covers all primitive types in all valid states to prevent regressions.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
} from 'vitest';
import {
  NotesPrimitivesSerializer,
  serializePrimitiveToMarkdown,
} from '../notes-primitives-serializer';
import {
  NotePrimitiveSchema,
  type ReferencePrimitive,
  type CliPrimitive,
  type AgentActionPrimitive,
  type PatchPrimitive,
  type NotePrimitive,
} from '$shared/types/notes-primitives';
import { v4 as uuidv4 } from 'uuid';

describe('Notes Primitives Round-trip Serialization', () => {
  let serializer: NotesPrimitivesSerializer;

  beforeEach(() => {
    serializer = new NotesPrimitivesSerializer();
  });

  // ============================================================================
  // Test Helpers
  // ============================================================================

  /**
   * Creates a base primitive with required fields
   */
  const createBase = (type: NotePrimitive['type']) => ({
    id: uuidv4(),
    type,
    version: 1 as const,
    createdAt: new Date().toISOString(),
    createdBy: 'user' as const,
  });

  /**
   * Simulates a round-trip: serialize to markdown, then parse back
   */
  const roundTrip = (primitive: NotePrimitive): NotePrimitive => {
    const markdown = serializePrimitiveToMarkdown(primitive);
    const parsed = serializer.parseMarkdown(markdown);
    expect(parsed).toHaveLength(1);
    return parsed[0].primitive;
  };

  /**
   * Simulates an attribute update (like clicking a button)
   */
  const simulateUpdate = <T extends NotePrimitive>(primitive: T, updates: Partial<T>): T =>
    ({ ...primitive, ...updates }) as T;

  /**
   * Validates that a primitive passes schema validation
   */
  const expectValidSchema = (primitive: NotePrimitive) => {
    const result = NotePrimitiveSchema.safeParse(primitive);
    if (!result.success) {
      console.error('Schema validation failed:', result.error.errors);
    }
    expect(result.success).toBe(true);
  };

  // ============================================================================
  // CLI Primitive Tests
  // ============================================================================

  describe('CLI Primitive', () => {
    const createCliPrimitive = (overrides: Partial<CliPrimitive> = {}): CliPrimitive => ({
      ...createBase('cli'),
      type: 'cli',
      command: 'npm test',
      cwd: '.',
      ...overrides,
    });

    it('should round-trip a basic CLI primitive', () => {
      const original = createCliPrimitive();
      expectValidSchema(original);

      const result = roundTrip(original);
      expect(result.type).toBe('cli');
      expect((result as CliPrimitive).command).toBe('npm test');
    });

    it('should round-trip CLI without lastRun (initial state)', () => {
      // CLI primitives start without lastRun - this is the "pending" state
      const original = createCliPrimitive();
      expect(original.lastRun).toBeUndefined();
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.lastRun).toBeUndefined();
    });

    it('should round-trip CLI with running status', () => {
      const original = createCliPrimitive({
        lastRun: {
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.lastRun?.status).toBe('running');
    });

    it('should round-trip CLI with success status', () => {
      const original = createCliPrimitive({
        lastRun: {
          status: 'success',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          exitCode: 0,
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.lastRun?.status).toBe('success');
      expect(result.lastRun?.exitCode).toBe(0);
    });

    it('should round-trip CLI with error status', () => {
      const original = createCliPrimitive({
        lastRun: {
          status: 'error',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          exitCode: 1,
          errorMessage: 'Command failed',
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.lastRun?.status).toBe('error');
      expect(result.lastRun?.errorMessage).toBe('Command failed');
    });

    it('should round-trip CLI with terminalId (set when run)', () => {
      const original = createCliPrimitive({
        terminalId: 'terminal-123456789-abcdef',
        lastRun: {
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.terminalId).toBe('terminal-123456789-abcdef');
    });

    it('should survive state transition: pending → running → success', () => {
      let primitive = createCliPrimitive();

      // Click "Run" - status becomes running
      primitive = simulateUpdate(primitive, {
        terminalId: `terminal-${Date.now()}`,
        lastRun: { status: 'running', startedAt: new Date().toISOString() },
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as CliPrimitive;
      expect(primitive.lastRun?.status).toBe('running');

      // Command completes
      primitive = simulateUpdate(primitive, {
        lastRun: {
          ...primitive.lastRun,
          status: 'success',
          completedAt: new Date().toISOString(),
          exitCode: 0,
        },
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as CliPrimitive;
      expect(primitive.lastRun?.status).toBe('success');
    });

    it('should round-trip CLI with createdByAgentId', () => {
      const original = createCliPrimitive({
        createdByAgentId: 'agent-123',
        createdBy: 'agent',
      });
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.createdByAgentId).toBe('agent-123');
    });
  });

  // ============================================================================
  // Agent Action Primitive Tests
  // ============================================================================

  describe('Agent Action Primitive', () => {
    const createAgentActionPrimitive = (
      overrides: Partial<AgentActionPrimitive> = {},
    ): AgentActionPrimitive => ({
      ...createBase('agent_action'),
      type: 'agent_action',
      agentId: 'code-review',
      goal: 'Review this code for bugs',
      inputs: [],
      ...overrides,
    });

    it('should round-trip a basic agent action primitive', () => {
      const original = createAgentActionPrimitive();
      expectValidSchema(original);

      const result = roundTrip(original);
      expect(result.type).toBe('agent_action');
      expect((result as AgentActionPrimitive).goal).toBe('Review this code for bugs');
    });

    it('should round-trip agent action without lastRun (initial state)', () => {
      // Agent action primitives start without lastRun - this is the "pending" state
      const original = createAgentActionPrimitive();
      expect(original.lastRun).toBeUndefined();
      expectValidSchema(original);

      const result = roundTrip(original) as AgentActionPrimitive;
      expect(result.lastRun).toBeUndefined();
    });

    it('should round-trip agent action with running status', () => {
      const original = createAgentActionPrimitive({
        lastRun: {
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as AgentActionPrimitive;
      expect(result.lastRun?.status).toBe('running');
    });

    it('should round-trip agent action with success status', () => {
      const original = createAgentActionPrimitive({
        lastRun: {
          status: 'success',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as AgentActionPrimitive;
      expect(result.lastRun?.status).toBe('success');
    });

    it('should round-trip agent action with error status', () => {
      const original = createAgentActionPrimitive({
        lastRun: {
          status: 'error',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          errorMessage: 'Agent failed',
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as AgentActionPrimitive;
      expect(result.lastRun?.status).toBe('error');
    });

    it('should round-trip agent action with createdByAgentId', () => {
      const original = createAgentActionPrimitive({
        createdByAgentId: 'parent-agent-456',
      });
      expectValidSchema(original);

      const result = roundTrip(original) as AgentActionPrimitive;
      expect(result.createdByAgentId).toBe('parent-agent-456');
    });

    it('should survive state transition: run agent action', () => {
      let primitive = createAgentActionPrimitive();

      // Click "Run" - creates agent and sets running
      primitive = simulateUpdate(primitive, {
        createdByAgentId: `new-agent-${Date.now()}`,
        lastRun: { status: 'running', startedAt: new Date().toISOString() },
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as AgentActionPrimitive;
      expect(primitive.lastRun?.status).toBe('running');
      expect(primitive.createdByAgentId).toBeDefined();

      // Agent completes
      primitive = simulateUpdate(primitive, {
        lastRun: {
          ...primitive.lastRun,
          status: 'success',
          completedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as AgentActionPrimitive;
      expect(primitive.lastRun?.status).toBe('success');
    });
  });

  // ============================================================================
  // Reference Primitive Tests
  // ============================================================================

  describe('Reference Primitive', () => {
    const createReferencePrimitive = (
      overrides: Partial<ReferencePrimitive> = {},
    ): ReferencePrimitive => ({
      ...createBase('reference'),
      type: 'reference',
      target: {
        kind: 'symbol',
        semanticId: 'src/main.ts#symbol:MyClass',
        filePath: 'src/main.ts',
      },
      ...overrides,
    });

    it('should round-trip a basic reference primitive', () => {
      const original = createReferencePrimitive();
      expectValidSchema(original);

      const result = roundTrip(original);
      expect(result.type).toBe('reference');
      expect((result as ReferencePrimitive).target.semanticId).toBe('src/main.ts#symbol:MyClass');
    });

    it('should round-trip reference with file_range kind', () => {
      const original = createReferencePrimitive({
        target: {
          kind: 'file_range',
          semanticId: 'src/main.ts#L10-L20',
          filePath: 'src/main.ts',
          startLine: 10,
          endLine: 20,
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as ReferencePrimitive;
      expect(result.target.kind).toBe('file_range');
      expect(result.target.startLine).toBe(10);
      expect(result.target.endLine).toBe(20);
    });

    it('should round-trip reference with line 0 (nonnegative)', () => {
      const original = createReferencePrimitive({
        target: {
          kind: 'file_range',
          semanticId: 'src/main.ts#L0-L5',
          filePath: 'src/main.ts',
          startLine: 0,
          endLine: 5,
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as ReferencePrimitive;
      expect(result.target.startLine).toBe(0);
    });

    it('should round-trip reference with snapshot', () => {
      const original = createReferencePrimitive({
        snapshot: {
          code: 'class MyClass { }',
          filePath: 'src/main.ts',
          languageId: 'typescript',
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as ReferencePrimitive;
      expect(result.snapshot?.code).toBe('class MyClass { }');
    });

    it('should round-trip reference with createdByAgentId', () => {
      const original = createReferencePrimitive({
        createdByAgentId: 'agent-789',
        createdBy: 'agent',
      });
      expectValidSchema(original);

      const result = roundTrip(original) as ReferencePrimitive;
      expect(result.createdByAgentId).toBe('agent-789');
    });
  });

  // ============================================================================
  // Patch Primitive Tests
  // ============================================================================

  describe('Patch Primitive', () => {
    const createPatchPrimitive = (overrides: Partial<PatchPrimitive> = {}): PatchPrimitive => ({
      ...createBase('patch'),
      type: 'patch',
      patches: [
        {
          filePath: 'src/main.ts',
          diff: '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,1 +1,2 @@\n old\n+new',
        },
      ],
      ...overrides,
    });

    it('should round-trip a basic patch primitive', () => {
      const original = createPatchPrimitive();
      expectValidSchema(original);

      const result = roundTrip(original);
      expect(result.type).toBe('patch');
      expect((result as PatchPrimitive).patches).toHaveLength(1);
    });

    it('should round-trip patch with success status', () => {
      const original = createPatchPrimitive({
        lastApply: {
          status: 'success',
          appliedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as PatchPrimitive;
      expect(result.lastApply?.status).toBe('success');
    });

    it('should round-trip patch with error status', () => {
      const original = createPatchPrimitive({
        lastApply: {
          status: 'error',
          appliedAt: new Date().toISOString(),
          errorMessage: 'Patch conflicts with current file',
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as PatchPrimitive;
      expect(result.lastApply?.status).toBe('error');
      expect(result.lastApply?.errorMessage).toBe('Patch conflicts with current file');
    });

    it('should round-trip patch with conflict status', () => {
      const original = createPatchPrimitive({
        lastApply: {
          status: 'conflict',
          appliedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(original);

      const result = roundTrip(original) as PatchPrimitive;
      expect(result.lastApply?.status).toBe('conflict');
    });

    it('should round-trip patch with multiple patches', () => {
      const original = createPatchPrimitive({
        patches: [
          { filePath: 'src/a.ts', diff: '@@ -1 +1 @@\n-old\n+new' },
          { filePath: 'src/b.ts', diff: '@@ -1 +1 @@\n-foo\n+bar' },
        ],
      });
      expectValidSchema(original);

      const result = roundTrip(original) as PatchPrimitive;
      expect(result.patches).toHaveLength(2);
    });

    it('should round-trip patch with createdByAgentId', () => {
      const original = createPatchPrimitive({
        createdByAgentId: 'agent-patch-123',
        createdBy: 'agent',
      });
      expectValidSchema(original);

      const result = roundTrip(original) as PatchPrimitive;
      expect(result.createdByAgentId).toBe('agent-patch-123');
    });

    it('should survive state transition: apply patch', () => {
      let primitive = createPatchPrimitive();

      // Click "Apply" - sets success status
      primitive = simulateUpdate(primitive, {
        lastApply: {
          status: 'success',
          appliedAt: new Date().toISOString(),
        },
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as PatchPrimitive;
      expect(primitive.lastApply?.status).toBe('success');

      // Click "Revert" - clears status
      primitive = simulateUpdate(primitive, {
        lastApply: undefined,
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as PatchPrimitive;
      expect(primitive.lastApply).toBeUndefined();
    });

    it('should survive state transition: apply patch fails', () => {
      let primitive = createPatchPrimitive();

      // Click "Apply" but it fails
      primitive = simulateUpdate(primitive, {
        lastApply: {
          status: 'error',
          appliedAt: new Date().toISOString(),
          errorMessage: 'corrupt patch at line 14',
        },
      });
      expectValidSchema(primitive);
      primitive = roundTrip(primitive) as PatchPrimitive;
      expect(primitive.lastApply?.status).toBe('error');
      expect(primitive.lastApply?.errorMessage).toBe('corrupt patch at line 14');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle primitives with all optional fields', () => {
      const original: CliPrimitive = {
        id: uuidv4(),
        type: 'cli',
        version: 1,
        label: 'Build Command',
        description: 'Builds the project',
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        createdByAgentId: 'agent-builder',
        command: 'npm run build',
        cwd: '/project',
        env: { NODE_ENV: 'production' },
        timeoutMs: 60000,
        terminalId: 'terminal-abc123',
        lastRun: {
          status: 'success',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          exitCode: 0,
        },
        outputSnapshot: {
          stdout: 'Build successful',
          stderr: '',
          truncated: false,
        },
        meta: { custom: 'data' },
      };
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.label).toBe('Build Command');
      expect(result.description).toBe('Builds the project');
      expect(result.createdByAgentId).toBe('agent-builder');
      expect(result.env).toEqual({ NODE_ENV: 'production' });
      expect(result.outputSnapshot?.stdout).toBe('Build successful');
      expect(result.meta).toEqual({ custom: 'data' });
    });

    it('should handle special characters in command', () => {
      const original: CliPrimitive = {
        id: uuidv4(),
        type: 'cli',
        version: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'user',
        command: 'echo "Hello, World!" && ls -la | grep "test"',
        cwd: '.',
      };
      expectValidSchema(original);

      const result = roundTrip(original) as CliPrimitive;
      expect(result.command).toBe('echo "Hello, World!" && ls -la | grep "test"');
    });

    it('should handle multiline diff content', () => {
      const multilineDiff = `--- a/src/file.ts
+++ b/src/file.ts
@@ -1,10 +1,15 @@
 import { foo } from 'bar';
+import { baz } from 'qux';

 export function main() {
-  console.log('old');
+  console.log('new');
+  // Added comment
   return true;
 }`;

      const original: PatchPrimitive = {
        id: uuidv4(),
        type: 'patch',
        version: 1,
        createdAt: new Date().toISOString(),
        createdBy: 'agent',
        patches: [{ filePath: 'src/file.ts', diff: multilineDiff }],
      };
      expectValidSchema(original);

      const result = roundTrip(original) as PatchPrimitive;
      expect(result.patches[0].diff).toBe(multilineDiff);
    });
  });
});
