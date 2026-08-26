/**
 * Tests for Agent Instructions
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getBaseInstruction } from '../base-system-prompt';
import { getMainActiveLocale } from '../../../../../main/main-locale';
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

vi.mock('../../../../../main/main-locale', () => ({
  getMainActiveLocale: vi.fn(() => 'en'),
}));

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

    it('teaches scoped and approval-gated sibling workspace handoffs', () => {
      expect(common).toContain(
        'ws.workspace.proposeSibling({ title, initialPrompt, specialist?, baseRef? })',
      );
      expect(common).toContain('clearly separate from the current request');
      expect(common).toContain('Make the initialPrompt self-contained');
      expect(common).toContain('The current repository is inherited and locked');
      expect(common).toContain('The user must approve it');
      expect(common).toContain('Never say that the workspace exists before Apply succeeds');
      expect(common).toContain('delegated or background agent');
      expect(common).toContain('ws.agent.reportToParent');
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
      expect(workspace).toContain('ws.workspace.setStatusImage({ data, mimeType, originalName? })');
      expect(workspace).toContain('ws.workspace.setStatusImage(null)');
      expect(workspace).toContain('meaningful visual result');
      expect(workspace).toContain('Workspace.status');
      expect(workspace).toContain('task statuses');
      expect(workspace).toContain('exactly one plain TL;DR sentence');
      expect(workspace).toContain('ideally 3–8 words and never more than 12 words');
      expect(workspace).toContain('Do not include test counts');
      expect(workspace).toContain('Ready for review.');
    });

    it('workspace-agent instruction documents statusMessage APIs', () => {
      expect(workspaceAgent).toContain('ws.workspace.details()');
      expect(workspaceAgent).toContain('ws.workspace.setStatusMessage(message)');
      expect(workspaceAgent).toContain(
        'ws.workspace.setStatusImage({ data, mimeType, originalName? } | null)',
      );
      expect(workspaceAgent).toContain('statusMessage');
      expect(workspaceAgent).toContain('one 3–8 word TL;DR sentence');
      expect(workspaceAgent).toContain('no counts or implementation details');
      expect(workspaceAgent).toContain('meaningful visual milestone');
      expect(workspaceAgent).toContain('clear stale images');
    });
  });

  describe('getBaseInstruction summary-language section', () => {
    beforeEach(() => {
      vi.mocked(getMainActiveLocale).mockReset();
    });

    it('omits the User Language section when the app language is English', () => {
      vi.mocked(getMainActiveLocale).mockReturnValue('en');
      const result = getBaseInstruction();
      expect(result).not.toContain('## User Language');
    });

    it('adds a language instruction for the summary fields when the app language is not English', () => {
      vi.mocked(getMainActiveLocale).mockReturnValue('zh-TW' as never);
      const result = getBaseInstruction();
      expect(result).toContain('## User Language');
      expect(result).toContain('Chinese (Taiwan)');
      expect(result).toContain('`summary` fields');
    });

    it('omits the section when the locale lookup throws at call time', () => {
      vi.mocked(getMainActiveLocale).mockImplementation(() => {
        throw new Error('electron unavailable');
      });
      const result = getBaseInstruction();
      expect(result).not.toContain('## User Language');
    });
  });
});
