/**
 * Provenance System Tests
 *
 * Tests for ProvenanceContextManager and AttributionEngine
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  ProvenanceContextManager,
  resetProvenanceContextManager,
  getProvenanceContextManager,
} from '../provenance-context-manager';
import {
  AttributionEngine,
  resetAttributionEngine,
  getAttributionEngine,
} from '../attribution-engine';
import { WorkspaceEventType } from '$features/events/types';

describe('ProvenanceContextManager', () => {
  let manager: ProvenanceContextManager;

  beforeEach(() => {
    resetProvenanceContextManager();
    manager = new ProvenanceContextManager({ debug: false });
  });

  afterEach(() => {
    manager.clear();
  });

  it('should push and pop contexts correctly', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const contextId = manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
    });

    expect(manager.getCurrentContext()).toBeDefined();
    expect(manager.getCurrentContext()?.agent?.id).toBe('agent-1');

    manager.popContext();
    expect(manager.getCurrentContext()).toBeUndefined();
  });

  it('should handle nested contexts', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx1 = manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Agent 1',
      messageId: 'msg-1',
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ctx2 = manager.createAgentContext({
      agentId: 'agent-2',
      agentName: 'Agent 2',
      messageId: 'msg-2',
    });

    expect(manager.getStackDepth()).toBe(2);
    expect(manager.getCurrentContext()?.agent?.id).toBe('agent-2');

    manager.popContext();
    expect(manager.getCurrentContext()?.agent?.id).toBe('agent-1');

    manager.popContext();
    expect(manager.getCurrentContext()).toBeUndefined();
  });

  it('should retrieve context by ID', () => {
    const contextId = manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
    });

    const context = manager.getContext(contextId);
    expect(context).toBeDefined();
    expect(context?.agent?.id).toBe('agent-1');
  });

  it('should validate context stack', () => {
    const validation = manager.validate();
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});

describe('AttributionEngine', () => {
  let manager: ProvenanceContextManager;
  let engine: AttributionEngine;

  beforeEach(() => {
    resetProvenanceContextManager();
    resetAttributionEngine();
    // Get the global instances
    manager = getProvenanceContextManager({ debug: false });
    engine = getAttributionEngine({ debug: false });
  });

  afterEach(() => {
    manager.clear();
  });

  it('should attribute changes to agent when context is active', async () => {
    manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
      turnNumber: 5,
    });

    const provenance = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/index.ts',
    });

    expect(provenance.source).toBe('agent');
    expect(provenance.agent?.id).toBe('agent-1');
    expect(provenance.chat?.turnNumber).toBe(5);
  });

  it('should default to user when no context is active', async () => {
    const provenance = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/index.ts',
    });

    expect(provenance.source).toBe('user');
    expect(provenance.agent).toBeUndefined();
  });

  it('should create file change events with provenance', async () => {
    manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
      turnNumber: 5,
    });

    const event = await engine.createFileChangeEvent(
      'workspace-1',
      {
        filePath: 'src/index.ts',
        action: 'modify',
        additions: 10,
        deletions: 5,
      },
      WorkspaceEventType.FileModified,
    );

    expect(event.type).toBe(WorkspaceEventType.FileModified);
    expect(event.actor.type).toBe('agent');
    expect(event.provenance?.source).toBe('agent');
    expect(event.provenance?.agent?.id).toBe('agent-1');
    expect(event.agentId).toBe('agent-1');
  });

  it('should create generic change events with provenance', async () => {
    manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
    });

    const event = await engine.createChangeEvent(
      'workspace-1',
      WorkspaceEventType.NoteCreated,
      'Created note: Meeting Notes',
    );

    expect(event.type).toBe(WorkspaceEventType.NoteCreated);
    expect(event.actor.type).toBe('agent');
    expect(event.provenance?.source).toBe('agent');
  });

  it('should get current provenance', () => {
    manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Test Agent',
      messageId: 'msg-1',
      model: 'gpt-4',
      temperature: 0.7,
    });

    const provenance = engine.getCurrentProvenance();

    expect(provenance).toBeDefined();
    expect(provenance?.source).toBe('agent');
    expect(provenance?.agent?.model).toBe('gpt-4');
    expect(provenance?.agent?.temperature).toBe(0.7);
  });

  it('should use content-based matching for agent attribution', async () => {
    // Record an agent write with specific content
    const fileContent = 'console.log("hello world");';
    engine.recordAgentWrite(
      {
        agentId: 'agent-1',
        agentName: 'Test Agent',
      },
      'src/utils.ts',
      fileContent,
    );

    // Attribute a change with matching content - should be attributed to agent
    const provenance1 = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/utils.ts',
      newContent: fileContent,
    });

    expect(provenance1.source).toBe('agent');
    expect(provenance1.agent?.id).toBe('agent-1');

    // Attribute a change with different content - should be attributed to user
    const provenance2 = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/utils.ts',
      newContent: 'different content',
    });

    expect(provenance2.source).toBe('user');
  });

  it('should normalize absolute paths with workspacePath for content matching', async () => {
    const fileContent = 'export function test() { return 42; }';
    const workspacePath = '/Users/test/repos/project';
    const absolutePath = '/Users/test/repos/project/src/helpers.ts';
    const relativePath = 'src/helpers.ts';

    // Record an agent write with absolute path and workspacePath
    engine.recordAgentWrite(
      {
        agentId: 'agent-2',
        agentName: 'Helper Agent',
      },
      absolutePath,
      fileContent,
      workspacePath,
    );

    // Attribute using relative path (as git would report) - should match
    const provenance = await engine.attributeChange({
      action: 'modify',
      filePath: relativePath,
      newContent: fileContent,
    });

    expect(provenance.source).toBe('agent');
    expect(provenance.agent?.id).toBe('agent-2');
    expect(provenance.agent?.name).toBe('Helper Agent');
  });
});

describe('Integration: Full Provenance Flow', () => {
  let manager: ProvenanceContextManager;
  let engine: AttributionEngine;

  beforeEach(() => {
    resetProvenanceContextManager();
    resetAttributionEngine();
    // Get the global instances
    manager = getProvenanceContextManager({ debug: false });
    engine = getAttributionEngine({ debug: false });
  });

  afterEach(() => {
    manager.clear();
    engine.clearAgentContext();
  });

  it('should track full provenance flow from context to event', async () => {
    // 1. Create agent context
    manager.createAgentContext({
      agentId: 'agent-1',
      agentName: 'Code Refactor',
      messageId: 'msg-1',
      turnNumber: 3,
      model: 'gpt-4',
      temperature: 0.7,
    });

    // 2. Attribute the change (context is active)
    const provenance = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/index.ts',
    });

    expect(provenance.source).toBe('agent');
    expect(provenance.agent?.id).toBe('agent-1');

    // 3. Create event
    const event = await engine.createFileChangeEvent(
      'workspace-1',
      {
        filePath: 'src/index.ts',
        action: 'modify',
        additions: 45,
        deletions: 12,
      },
      WorkspaceEventType.FileModified,
    );

    // Verify full chain
    expect(event.actor.type).toBe('agent');
    expect(event.actor.id).toBe('agent-1');
    expect(event.provenance?.source).toBe('agent');
    expect(event.provenance?.agent?.name).toBe('Code Refactor');
    expect(event.provenance?.chat?.turnNumber).toBe(3);
    expect(event.provenance?.agent?.model).toBe('gpt-4');
    expect(event.codeChange?.additions).toBe(45);
    expect(event.codeChange?.deletions).toBe(12);
  });

  it('should track content-based attribution flow', async () => {
    const fileContent = 'export const VERSION = "1.0.0";';

    // 1. Record agent write (simulating agent tool execution)
    engine.recordAgentWrite(
      {
        agentId: 'agent-2',
        agentName: 'Version Updater',
        sessionId: 'session-1',
      },
      'src/version.ts',
      fileContent,
    );

    // 2. Attribute the change using content matching (no active context)
    const provenance = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/version.ts',
      newContent: fileContent,
    });

    expect(provenance.source).toBe('agent');
    expect(provenance.agent?.id).toBe('agent-2');
    expect(provenance.agent?.name).toBe('Version Updater');

    // 3. Create event
    const event = await engine.createFileChangeEvent(
      'workspace-1',
      {
        filePath: 'src/version.ts',
        action: 'modify',
        additions: 1,
        deletions: 0,
        newContent: fileContent,
      },
      WorkspaceEventType.FileModified,
    );

    // Event should use content-based matching and attribute to agent
    // Even though there's no active context, the content hash matches the recorded agent write
    expect(event.actor.type).toBe('agent');
    expect(event.actor.id).toBe('agent-2');
    expect(event.provenance?.source).toBe('agent');
    expect(event.provenance?.agent?.name).toBe('Version Updater');
  });

  it('should persist agent writes to disk when workspaceId is provided', async () => {
    const fileContent = 'export const VERSION = "2.0.0";';
    const workspaceId = 'test-workspace-123';

    // 1. Record agent write with workspaceId (simulating agent tool execution)
    engine.recordAgentWrite(
      {
        agentId: 'agent-3',
        agentName: 'Persistence Tester',
        sessionId: 'session-2',
      },
      'src/version.ts',
      fileContent,
      undefined, // workspacePath
      workspaceId, // workspaceId - this should trigger persistence
    );

    // 2. Wait for debounced persistence to complete
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 3. Attribute the change using content matching
    const provenance = await engine.attributeChange({
      action: 'modify',
      filePath: 'src/version.ts',
      newContent: fileContent,
    });

    expect(provenance.source).toBe('agent');
    expect(provenance.agent?.id).toBe('agent-3');
    expect(provenance.agent?.name).toBe('Persistence Tester');
  });
});
