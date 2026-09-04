/**
 * Tests for agent-task metadata linking
 * Phase 1C - Increment 3: Store Task ID in Agent Session Metadata
 */

import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { AgentMetadata } from '$shared/types';
import { NoteId } from '$shared/types/branded-ids';

describe('Agent-Task Metadata Linking', () => {
  describe('AgentMetadata schema', () => {
    it('should accept taskNoteId field', () => {
      const noteId = uuidv4() as NoteId;

      const metadata: AgentMetadata = {
        taskNoteId: noteId,
        agentType: 'task-focused',
        source: 'task-menu',
      };

      expect(metadata.taskNoteId).toBe(noteId);
    });

    it('should allow taskNoteId to be undefined', () => {
      const metadata: AgentMetadata = {
        agentType: 'chat',
      };

      expect(metadata.taskNoteId).toBeUndefined();
    });

    it('should allow taskNoteId alongside other metadata', () => {
      const noteId = uuidv4() as NoteId;

      const metadata: AgentMetadata = {
        taskNoteId: noteId,
        agentType: 'task-loop',
        source: 'bubble-menu',
        contextReferences: [],
        isBackground: false,
      };

      expect(metadata.taskNoteId).toBe(noteId);
      expect(metadata.agentType).toBe('task-loop');
      expect(metadata.source).toBe('bubble-menu');
    });
  });

  describe('Agent factory integration', () => {
    it('should preserve taskNoteId when passed in metadata', () => {
      const noteId = uuidv4() as NoteId;

      // Simulate what agent factory would do
      const inputMetadata = {
        taskNoteId: noteId,
        agentType: 'task-focused',
      };

      const agentMetadata: AgentMetadata = {
        ...inputMetadata,
        source: 'task-menu',
      };

      expect(agentMetadata.taskNoteId).toBe(noteId);
    });

    it('should handle missing taskNoteId gracefully', () => {
      const inputMetadata = {
        agentType: 'chat',
      };

      const agentMetadata: AgentMetadata = {
        ...inputMetadata,
        source: 'chat-panel',
      };

      expect(agentMetadata.taskNoteId).toBeUndefined();
    });
  });

  describe('Bidirectional linking', () => {
    it('should support querying agent by taskNoteId', () => {
      const noteId = uuidv4() as NoteId;

      // Simulate agent sessions
      const agents = [
        { id: 'agent-1', metadata: { taskNoteId: noteId, agentType: 'task-loop' } },
        { id: 'agent-2', metadata: { agentType: 'chat' } },
        { id: 'agent-3', metadata: { taskNoteId: uuidv4() as NoteId, agentType: 'debug' } },
      ];

      // Query agents by taskNoteId
      const agentsForTask = agents.filter((a) => a.metadata.taskNoteId === noteId);

      expect(agentsForTask).toHaveLength(1);
      expect(agentsForTask[0].id).toBe('agent-1');
    });

    it('should support multiple agents for same task', () => {
      const noteId = uuidv4() as NoteId;

      // Simulate multiple agents working on same task
      const agents = [
        { id: 'agent-1', metadata: { taskNoteId: noteId, agentType: 'workspace' } },
        { id: 'agent-2', metadata: { taskNoteId: noteId, agentType: 'task-loop' } },
        { id: 'agent-3', metadata: { taskNoteId: noteId, agentType: 'task-focused' } },
      ];

      const agentsForTask = agents.filter((a) => a.metadata.taskNoteId === noteId);

      expect(agentsForTask).toHaveLength(3);
      expect(agentsForTask.map((a) => a.id)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });
  });
});
