/**
 * Tests for MockPersistenceService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockPersistenceService } from '../persistence.mock';
import type { AgentSession, AgentMessage } from '$shared/types';
import { AgentStatus } from '$shared/types';
import * as BrandedIds from '$shared/types/branded-ids';

describe('MockPersistenceService', () => {
  let service: MockPersistenceService;

  beforeEach(() => {
    service = new MockPersistenceService();
  });

  describe('Session Operations', () => {
    it('should save and load a session', async () => {
      const session: AgentSession = {
        id: BrandedIds.AgentId('agent-1'),
        backendSessionId: BrandedIds.SessionId('session-1'),
        workspaceId: BrandedIds.WorkspaceId('workspace-1'),
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.saveSession(session, BrandedIds.WorkspaceId('workspace-1'));
      const loaded = await service.loadSession(
        BrandedIds.AgentId('agent-1'),
        BrandedIds.WorkspaceId('workspace-1'),
      );

      expect(loaded).toEqual(session);
    });

    it('should return null for non-existent session', async () => {
      const loaded = await service.loadSession('non-existent', 'workspace-1');
      expect(loaded).toBeNull();
    });

    it('should delete a session', async () => {
      const session: AgentSession = {
        id: BrandedIds.AgentId('agent-1'),
        backendSessionId: BrandedIds.SessionId('session-1'),
        workspaceId: BrandedIds.WorkspaceId('workspace-1'),
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.saveSession(session, BrandedIds.WorkspaceId('workspace-1'));
      await service.deleteSession(
        BrandedIds.AgentId('agent-1'),
        BrandedIds.WorkspaceId('workspace-1'),
      );

      const loaded = await service.loadSession(
        BrandedIds.AgentId('agent-1'),
        BrandedIds.WorkspaceId('workspace-1'),
      );
      expect(loaded).toBeNull();
    });

    it('should list sessions for a workspace', async () => {
      const session1: AgentSession = {
        id: BrandedIds.AgentId('agent-1'),
        backendSessionId: BrandedIds.SessionId('session-1'),
        workspaceId: BrandedIds.WorkspaceId('workspace-1'),
        name: 'Agent 1',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const session2: AgentSession = {
        id: BrandedIds.AgentId('agent-2'),
        backendSessionId: BrandedIds.SessionId('session-2'),
        workspaceId: BrandedIds.WorkspaceId('workspace-1'),
        name: 'Agent 2',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.saveSession(session1, BrandedIds.WorkspaceId('workspace-1'));
      await service.saveSession(session2, BrandedIds.WorkspaceId('workspace-1'));

      const sessions = await service.listSessions(BrandedIds.WorkspaceId('workspace-1'));
      expect(sessions).toHaveLength(2);
      expect(sessions).toContainEqual(session1);
      expect(sessions).toContainEqual(session2);
    });
  });

  describe('Message Operations', () => {
    it('should save and load messages', async () => {
      const message: AgentMessage = {
        id: BrandedIds.MessageId('msg-1'),
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello' }],
        timestamp: new Date(),
      };

      await service.saveMessage(message, 'session-1');
      const messages = await service.loadMessages('session-1');

      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(message);
    });

    it('should accumulate multiple messages', async () => {
      const msg1: AgentMessage = {
        id: BrandedIds.MessageId('msg-1'),
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'Hello' }],
        timestamp: new Date(),
      };

      const msg2: AgentMessage = {
        id: BrandedIds.MessageId('msg-2'),
        role: 'assistant',
        contentBlocks: [{ type: 'text', text: 'Hi there' }],
        timestamp: new Date(),
      };

      await service.saveMessage(msg1, 'session-1');
      await service.saveMessage(msg2, 'session-1');

      const messages = await service.loadMessages('session-1');
      expect(messages).toHaveLength(2);
    });
  });

  describe('Metadata Operations', () => {
    it('should save and load metadata', async () => {
      const metadata = { key: 'value', nested: { data: 123 } };

      await service.saveMetadata('test-key', metadata);
      const loaded = await service.loadMetadata('test-key');

      expect(loaded).toEqual(metadata);
    });

    it('should return undefined for non-existent metadata', async () => {
      const loaded = await service.loadMetadata('non-existent');
      expect(loaded).toBeUndefined();
    });
  });

  describe('History Tracking', () => {
    it('should track save operations', async () => {
      const session: AgentSession = {
        id: BrandedIds.AgentId('agent-1'),
        backendSessionId: BrandedIds.SessionId('session-1'),
        workspaceId: BrandedIds.WorkspaceId('workspace-1'),
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.saveSession(session, BrandedIds.WorkspaceId('workspace-1'));

      const history = service.getSaveHistory();
      expect(history).toHaveLength(1);
      expect(history[0].key).toContain('session:workspace-1:agent-1');
    });

    it('should track load operations', async () => {
      await service.loadSession(
        BrandedIds.AgentId('agent-1'),
        BrandedIds.WorkspaceId('workspace-1'),
      );

      const history = service.getLoadHistory();
      expect(history).toHaveLength(1);
      expect(history[0].key).toContain('session:workspace-1:agent-1');
    });
  });

  describe('Clear Operations', () => {
    it('should clear all data', async () => {
      const session: AgentSession = {
        id: BrandedIds.AgentId('agent-1'),
        backendSessionId: BrandedIds.SessionId('session-1'),
        workspaceId: BrandedIds.WorkspaceId('workspace-1'),
        name: 'Test Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await service.saveSession(session, BrandedIds.WorkspaceId('workspace-1'));
      service.clear();

      const loaded = await service.loadSession(
        BrandedIds.AgentId('agent-1'),
        BrandedIds.WorkspaceId('workspace-1'),
      );
      expect(loaded).toBeNull();
      expect(service.getSaveHistory()).toHaveLength(0);
    });
  });
});
