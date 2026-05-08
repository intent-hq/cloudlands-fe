/**
 * Tests for event types and type guards
 */

import { describe, it, expect } from 'vitest';
import {
  isFileChangedEvent,
  isAgentToolCallEvent,
  isAgentMessageEvent,
  isGitOperationEvent,
  isNoteChangedEvent,
  isTaskStatusChangedEvent,
  isReadyTasksChangedEvent,
  isTerminalCommandEvent,
  isTestEvent,
  isBuildEvent,
  isAgentCreatedEvent,
  isAgentIdleEvent,
  isAgentInteractionEvent,
  normalizeActor,
  createWorkspaceEvent,
  generateEventId,
  type AgentStatusPayload,
  type WorkspaceEvent,
} from '../types';

describe('event types', () => {
  const requiredCanonicalStatusFields = {
    activationState: 'active',
    isActive: true,
    isStreaming: true,
    isProcessing: true,
    isResponding: true,
    stopReason: null,
  } as const;

  const createEvent = (type: string, data?: any): WorkspaceEvent => ({
    id: 'test-event',
    workspaceId: 'test-workspace',
    timestamp: new Date().toISOString(),
    type: type as any,
    actor: { type: 'user' },
    data,
  });

  it('requires canonical fields on raw agent:status IPC payloads', () => {
    const payload = {
      agentId: 'agent-1',
      status: 'responding',
      ...requiredCanonicalStatusFields,
    } satisfies AgentStatusPayload;

    // @ts-expect-error agent:status payloads must include all canonical status fields.
    const missingCanonicalFields = { agentId: 'agent-1', status: 'responding' } satisfies AgentStatusPayload;

    expect(payload).toMatchObject({
      agentId: 'agent-1',
      status: 'responding',
      ...requiredCanonicalStatusFields,
    });
    expect(missingCanonicalFields).toMatchObject({ agentId: 'agent-1', status: 'responding' });
  });

  describe('type guards', () => {
    it('isFileChangedEvent should detect file:changed events', () => {
      expect(isFileChangedEvent(createEvent('file:changed'))).toBe(true);
      expect(isFileChangedEvent(createEvent('file:created'))).toBe(false);
    });

    it('isAgentToolCallEvent should detect agent:tool:call events', () => {
      expect(isAgentToolCallEvent(createEvent('agent:tool:call'))).toBe(true);
      expect(isAgentToolCallEvent(createEvent('agent:message'))).toBe(false);
    });

    it('isAgentMessageEvent should detect agent:message events', () => {
      expect(isAgentMessageEvent(createEvent('agent:message'))).toBe(true);
      expect(isAgentMessageEvent(createEvent('agent:started'))).toBe(false);
    });

    it('isGitOperationEvent should detect git events', () => {
      expect(isGitOperationEvent(createEvent('git:commit'))).toBe(true);
      expect(isGitOperationEvent(createEvent('git:push'))).toBe(true);
      expect(isGitOperationEvent(createEvent('file:changed'))).toBe(false);
    });

    it('isNoteChangedEvent should detect note events', () => {
      expect(isNoteChangedEvent(createEvent('note:created'))).toBe(true);
      expect(isNoteChangedEvent(createEvent('note:updated'))).toBe(true);
      expect(isNoteChangedEvent(createEvent('file:changed'))).toBe(false);
    });

    it('isTaskStatusChangedEvent should detect task:status-changed events', () => {
      expect(isTaskStatusChangedEvent(createEvent('task:status-changed'))).toBe(true);
      expect(isTaskStatusChangedEvent(createEvent('task:ready-tasks-changed'))).toBe(false);
    });

    it('isReadyTasksChangedEvent should detect task:ready-tasks-changed events', () => {
      expect(isReadyTasksChangedEvent(createEvent('task:ready-tasks-changed'))).toBe(true);
      expect(isReadyTasksChangedEvent(createEvent('task:status-changed'))).toBe(false);
    });

    it('isTerminalCommandEvent should detect terminal:command events', () => {
      expect(isTerminalCommandEvent(createEvent('terminal:command'))).toBe(true);
      expect(isTerminalCommandEvent(createEvent('file:changed'))).toBe(false);
    });

    it('isTestEvent should detect test events', () => {
      expect(isTestEvent(createEvent('test:started'))).toBe(true);
      expect(isTestEvent(createEvent('test:completed'))).toBe(true);
      expect(isTestEvent(createEvent('build:started'))).toBe(false);
    });

    it('isBuildEvent should detect build events', () => {
      expect(isBuildEvent(createEvent('build:started'))).toBe(true);
      expect(isBuildEvent(createEvent('build:completed'))).toBe(true);
      expect(isBuildEvent(createEvent('test:started'))).toBe(false);
    });

    it('isAgentCreatedEvent should detect agent:created events', () => {
      expect(isAgentCreatedEvent(createEvent('agent:created'))).toBe(true);
      expect(isAgentCreatedEvent(createEvent('agent:idle'))).toBe(false);
    });

    it('isAgentIdleEvent should detect agent:idle events', () => {
      expect(isAgentIdleEvent(createEvent('agent:idle'))).toBe(true);
      expect(isAgentIdleEvent(createEvent('agent:created'))).toBe(false);
    });

    it('isAgentInteractionEvent should detect all agent interaction events', () => {
      expect(isAgentInteractionEvent(createEvent('agent:created'))).toBe(true);
      expect(isAgentInteractionEvent(createEvent('agent:idle'))).toBe(true);
      expect(isAgentInteractionEvent(createEvent('agent:message:sent'))).toBe(true);
      expect(isAgentInteractionEvent(createEvent('agent:message:received'))).toBe(true);
      expect(isAgentInteractionEvent(createEvent('agent:subscribed'))).toBe(true);
      expect(isAgentInteractionEvent(createEvent('agent:unsubscribed'))).toBe(true);
      expect(isAgentInteractionEvent(createEvent('agent:started'))).toBe(false);
    });
  });

  describe('normalizeActor', () => {
    it('should fill in defaults for minimal actor', () => {
      const actor = normalizeActor({ type: 'user' });
      expect(actor.type).toBe('user');
      expect(actor.id).toBeDefined();
      expect(actor.name).toBe('Unknown');
    });

    it('should use "System" name for system actors', () => {
      const actor = normalizeActor({ type: 'system' });
      expect(actor.name).toBe('System');
    });

    it('should preserve provided values', () => {
      const actor = normalizeActor({
        type: 'agent',
        id: 'agent-1',
        name: 'Test Agent',
        model: 'gpt-4',
      });
      expect(actor.id).toBe('agent-1');
      expect(actor.name).toBe('Test Agent');
      expect(actor.model).toBe('gpt-4');
    });
  });

  describe('createWorkspaceEvent', () => {
    it('should create event with defaults', () => {
      const event = createWorkspaceEvent('file:changed', 'ws-1', { type: 'user' });
      expect(event.id).toMatch(/^evt_/);
      expect(event.workspaceId).toBe('ws-1');
      expect(event.type).toBe('file:changed');
      expect(event.actor.type).toBe('user');
      expect(event.timestamp).toBeDefined();
    });
  });

  describe('generateEventId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateEventId();
      const id2 = generateEventId();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^evt_/);
    });
  });
});
