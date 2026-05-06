/**
 * Tests for Agent Instructions
 */

import { describe, it, expect } from 'vitest';
import {
  getInstructionById,
  getAvailableInstructionIds,
  getInstructionWithCommon,
  baseSystemPrompt,
  chat,
  common,
  workspace,
  taskBreakdown,
  debug,
  codeReview,
  commitMessage,
  prDescription,
  workspaceAgent,
} from '../index';

describe('Agent Instructions', () => {
  describe('getInstructionById', () => {
    it('should return instruction for valid ID', () => {
      const instruction = getInstructionById('debug');
      expect(instruction).toBeDefined();
      expect(typeof instruction).toBe('string');
      expect(instruction.length).toBeGreaterThan(0);
    });

    it('should return workspace for unknown ID with fallback', () => {
      const instruction = getInstructionById('unknown-type', true);
      expect(instruction).toBe(workspace);
    });

    it('should throw for unknown ID without fallback', () => {
      expect(() => getInstructionById('unknown-type', false)).toThrow('Unknown instruction');
    });

    it('should handle aliases', () => {
      expect(getInstructionById('fix')).toBe(debug);
      expect(getInstructionById('review')).toBe(codeReview);
    });
  });

  describe('getAvailableInstructionIds', () => {
    it('should return array of instruction IDs', () => {
      const ids = getAvailableInstructionIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBeGreaterThan(0);
    });

    it('should include core instruction types', () => {
      const ids = getAvailableInstructionIds();
      expect(ids).toContain('chat');
      expect(ids).toContain('debug');
      expect(ids).toContain('workspace');
    });

    it('should include utility agents', () => {
      const ids = getAvailableInstructionIds();
      expect(ids).toContain('code-review');
      expect(ids).toContain('commit-message');
      expect(ids).toContain('pr-description');
    });
  });

  describe('getInstructionWithCommon', () => {
    it('should combine specific instruction with common', () => {
      const combined = getInstructionWithCommon('debug');
      expect(combined).toContain(debug);
      expect(combined).toContain(common);
    });

    it('should not duplicate common for common instruction', () => {
      const result = getInstructionWithCommon('common');
      expect(result).toBe(common);
    });

    it('should handle workspace instruction', () => {
      const result = getInstructionWithCommon('workspace');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should include workspace for non-utility agents', () => {
      const combined = getInstructionWithCommon('task-loop');
      expect(combined).toContain(workspace);
    });

    it('should not include workspace for utility agents', () => {
      const combined = getInstructionWithCommon('code-review');
      expect(combined).not.toContain(workspace);
    });
  });

  describe('instruction content', () => {
    it('should have non-empty base system prompt', () => {
      expect(baseSystemPrompt).toBeDefined();
      expect(baseSystemPrompt.length).toBeGreaterThan(100);
    });

    it('should have non-empty chat instruction', () => {
      expect(chat).toBeDefined();
      expect(chat.length).toBeGreaterThan(50);
    });

    it('should have non-empty common instruction', () => {
      expect(common).toBeDefined();
      expect(common.length).toBeGreaterThan(50);
    });

    it('should have non-empty utility agent instructions', () => {
      expect(codeReview).toBeDefined();
      expect(commitMessage).toBeDefined();
      expect(prDescription).toBeDefined();
    });

    it('should include critical delegation instructions in common', () => {
      // Delegation instructions - these ensure agents list tasks before delegating
      expect(common).toContain('Before delegating');
      expect(common).toContain('list the tasks');
      expect(common).toContain('ws.agent.delegate(');
      expect(common).toContain('Never use `ws.agent.create` for tasks that already have IDs');
    });

    it('forces breakdown agents to use task blocks (not checkbox lists) and to materialize spec tasks', () => {
      expect(taskBreakdown).toContain('Do not use markdown checkbox lists');
      expect(taskBreakdown).toContain('task block');
      expect(taskBreakdown).toContain('ws.task.convertBlocks("spec")');
    });

    it('workspace instruction contains core workspace concepts', () => {
      // workspace.ts contains shared instructions for workspace agents
      expect(workspace).toContain('Space');
      expect(workspace).toContain('notes');
      expect(workspace).toContain('ws.agent.delegate');
      expect(workspace).toContain('ws.note.read');
      expect(workspace).toContain('statusMessage');
      expect(workspace).toContain('ws.workspace.setStatusMessage(message)');
      expect(workspace).toContain('Workspace.status');
      expect(workspace).toContain('task statuses');
    });

    it('workspace-agent instruction documents statusMessage APIs', () => {
      expect(workspaceAgent).toContain('ws.workspace.details()');
      expect(workspaceAgent).toContain('ws.workspace.setStatusMessage(message)');
      expect(workspaceAgent).toContain('statusMessage');
    });
  });
});
