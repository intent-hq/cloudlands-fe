/**
 * Tests for Zod Schemas
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  AgentIdSchema,
  SessionIdSchema,
  MessageIdSchema,
  ContentBlockSchema,
  ToolCallSchema,
  AgentMessageSchema,
  AgentSessionSchema,
  validateAgentSession,
  validateAgentMessage,
  validateContentBlock,
  validateToolCall,
  safeValidateAgentSession,
  safeValidateAgentMessage,
  safeValidateContentBlock,
  safeValidateToolCall,
  workspaceIdSchema,
  WorkspaceSchema,
} from '../../schemas';
import { WorkspaceStatus } from '../../types';

describe('Zod Schemas', () => {
  describe('ID Schemas', () => {
    it('should validate agent IDs', () => {
      expect(() => AgentIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
      expect(() => AgentIdSchema.parse('agent-123')).not.toThrow();
    });

    it('should validate session IDs', () => {
      expect(() => SessionIdSchema.parse('sess_123')).not.toThrow();
      expect(() => SessionIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });

    it('should validate message IDs', () => {
      expect(() => MessageIdSchema.parse('msg_123')).not.toThrow();
      expect(() => MessageIdSchema.parse('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });
  });

  describe('ContentBlockSchema', () => {
    it('should validate text blocks', () => {
      const block = { type: 'text', text: 'hello' };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });

    it('should validate code blocks', () => {
      const block = { type: 'code', content: 'code', language: 'typescript' };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });

    it('should validate tool use blocks', () => {
      const block = { type: 'tool_use', name: 'test', id: '123', input: {} };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });

    it('should validate tool result blocks', () => {
      const block = { type: 'tool_result', tool_use_id: '123', output: 'result' };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });

    it('should validate thinking blocks', () => {
      const block = { type: 'thinking', content: 'thinking...' };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });

    it('should reject invalid types', () => {
      expect(() => ContentBlockSchema.parse({ type: 'invalid' })).toThrow();
    });

    // Regression: ws.app.workspaces.* tools emit chat-embedded proposal blocks
    // via emitProposalToChat. Persistence runs ContentBlockSchema before
    // saveAgent writes to disk — if 'proposal' is missing from the type enum
    // the whole agent save is rejected and the proposal block never reaches
    // disk (and disappears from history on reload).
    it('should validate proposal blocks emitted by ws.app.workspaces.archive', () => {
      const block = {
        type: 'proposal',
        kind: 'bulk-op',
        payload: { operation: 'workspace.bulkArchive', ids: ['ability-add'] },
        preview: { title: 'Archive 1 workspace' },
        applyToolCallId: 'toolu_abc',
        proposal: {
          kind: 'bulk-op',
          payload: { operation: 'workspace.bulkArchive', ids: ['ability-add'] },
          preview: { title: 'Archive 1 workspace' },
          applyToolCallId: 'toolu_abc',
        },
      };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });

    it('should validate nav-link blocks', () => {
      const block = {
        type: 'nav-link',
        kind: 'nav-link',
        target: '/settings#agents',
        label: 'Open agents settings',
      };
      expect(() => ContentBlockSchema.parse(block)).not.toThrow();
    });
  });

  describe('ToolCallSchema', () => {
    it('should validate tool calls', () => {
      const call = {
        id: 'tool-123',
        name: 'test_tool',
        arguments: { arg1: 'value' },
        timestamp: '2024-01-01T00:00:00Z',
      };
      expect(() => ToolCallSchema.parse(call)).not.toThrow();
    });

    it('should allow optional fields', () => {
      const call = {
        id: 'tool-123',
        name: 'test_tool',
        arguments: {},
        timestamp: '2024-01-01T00:00:00Z',
        status: 'completed',
        result: 'success',
      };
      expect(() => ToolCallSchema.parse(call)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() => ToolCallSchema.parse({ id: 'tool-123' })).toThrow();
      expect(() => ToolCallSchema.parse({ name: 'test' })).toThrow();
    });
  });

  describe('AgentMessageSchema', () => {
    it('should validate messages', () => {
      const message = {
        id: 'msg_123',
        role: 'user',
        content: 'Hello',
        timestamp: '2024-01-01T00:00:00Z',
      };
      expect(() => AgentMessageSchema.parse(message)).not.toThrow();
    });

    it('should accept all valid roles', () => {
      const roles = ['user', 'assistant', 'system', 'error'];
      roles.forEach((role) => {
        const message = {
          id: 'msg_123',
          role,
          content: 'Hello',
          timestamp: new Date(),
        };
        expect(() => AgentMessageSchema.parse(message)).not.toThrow();
      });
    });

    it('should allow optional fields', () => {
      const message = {
        id: 'msg_123',
        appMessageId: 'app_msg_123',
        role: 'assistant',
        content: 'Hello',
        timestamp: new Date(),
        contentBlocks: [{ type: 'text', text: 'hello' }],
        toolCalls: [
          {
            id: 'tool-1',
            name: 'test',
            arguments: {},
            timestamp: '2024-01-01T00:00:00Z',
          },
        ],
        isStreaming: true,
      };
      expect(() => AgentMessageSchema.parse(message)).not.toThrow();
    });

    it('should reject invalid roles', () => {
      expect(() =>
        AgentMessageSchema.parse({
          id: 'msg_123',
          role: 'invalid',
          content: 'Hello',
          timestamp: new Date(),
        }),
      ).toThrow();
    });
  });

  describe('AgentSessionSchema', () => {
    it('should validate sessions', () => {
      const session = {
        id: 'agent-123',
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [],
        status: 'active',
      };
      expect(() => AgentSessionSchema.parse(session)).not.toThrow();
    });

    it('should allow optional fields', () => {
      const session = {
        id: 'agent-123',
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [
          {
            id: 'msg_1',
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
          },
        ],
        status: 'active',
        name: 'Test Session',
        model: 'gpt-4',
        isStreaming: false,
      };
      expect(() => AgentSessionSchema.parse(session)).not.toThrow();
    });

    it('should accept null model for default model case', () => {
      const session = {
        id: 'agent-123',
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [],
        status: 'active',
        model: null,
      };
      expect(() => AgentSessionSchema.parse(session)).not.toThrow();
      expect(() => validateAgentSession(session)).not.toThrow();
      const validated = validateAgentSession(session);
      expect(validated.model).toBe(null);
    });
  });

  describe('Validation Functions', () => {
    it('should validate and throw on invalid data', () => {
      expect(() => validateAgentSession(null)).toThrow();
      expect(() => validateAgentMessage(null)).toThrow();
      expect(() => validateContentBlock(null)).toThrow();
      expect(() => validateToolCall(null)).toThrow();
    });

    it('should return data on valid input', () => {
      const session = {
        id: 'agent-123',
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [],
        status: 'active',
      };
      const result = validateAgentSession(session);
      expect(result).toEqual(session);
    });
  });

  describe('workspaceIdSchema', () => {
    it('should accept valid slug format', () => {
      expect(() => workspaceIdSchema.parse('amber-forest')).not.toThrow();
    });

    it('should accept slug with collision suffix', () => {
      expect(() => workspaceIdSchema.parse('amber-forest-2')).not.toThrow();
    });

    it('should accept valid optimistic workspace ID', () => {
      expect(() => workspaceIdSchema.parse('optimistic-1711000000000-abc123')).not.toThrow();
    });

    it('should accept slug starting with "optimistic" (regression: optimistic-remove-4)', () => {
      // Regression test: slugs that happen to start with "optimistic-" should pass
      // as regular slugs, not be rejected by the optimistic pattern check
      expect(() => workspaceIdSchema.parse('optimistic-remove-4')).not.toThrow();
    });

    it('should accept slug starting with "optimistic" (regression: optimistic-update)', () => {
      expect(() => workspaceIdSchema.parse('optimistic-update')).not.toThrow();
    });

    it('should reject empty string', () => {
      expect(() => workspaceIdSchema.parse('')).toThrow();
    });

    it('should reject string with spaces', () => {
      expect(() => workspaceIdSchema.parse('amber forest')).toThrow();
    });

    it('should accept valid UUID', () => {
      expect(() =>
        workspaceIdSchema.parse('550e8400-e29b-41d4-a716-446655440000'),
      ).not.toThrow();
    });
  });

  describe('WorkspaceSchema', () => {
    const baseWorkspace = {
      id: 'amber-forest',
      title: 'Test Workspace',
      branch: 'feature/test',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    };

    it('passes cowSupported and checkoutMode through validation (regression: fields were stripped, hiding the CoW toggle)', () => {
      const workspace = {
        ...baseWorkspace,
        cowSupported: true,
        checkoutMode: 'cow',
      };
      const parsed = WorkspaceSchema.parse(workspace);
      expect(parsed.cowSupported).toBe(true);
      expect(parsed.checkoutMode).toBe('cow');
    });

    it('accepts the wire checkoutMode values and rejects non-wire ones', () => {
      // PROTOCOL §5.1: checkoutMode is "cow" | "worktree"; omitted (never
      // "direct") for rows without a daemon-provisioned checkout.
      for (const mode of ['cow', 'worktree']) {
        expect(WorkspaceSchema.parse({ ...baseWorkspace, checkoutMode: mode }).checkoutMode).toBe(
          mode,
        );
      }
      expect(() => WorkspaceSchema.parse({ ...baseWorkspace, checkoutMode: 'direct' })).toThrow();
      expect(() => WorkspaceSchema.parse({ ...baseWorkspace, checkoutMode: 'bogus' })).toThrow();
    });

    it('accepts setupScript as the wire SetupScript object and as a legacy string', () => {
      // PROTOCOL §5.25: the daemon emits setupScript as an object
      // { script, updatedAt, projectType?, generatedBy? }.
      const wire = WorkspaceSchema.parse({
        ...baseWorkspace,
        setupScript: { script: 'pnpm install', updatedAt: '2026-07-26T00:00:00.000Z' },
      });
      expect(wire.setupScript).toEqual({
        script: 'pnpm install',
        updatedAt: '2026-07-26T00:00:00.000Z',
      });
      const legacy = WorkspaceSchema.parse({ ...baseWorkspace, setupScript: 'pnpm install' });
      expect(legacy.setupScript).toBe('pnpm install');
    });

    it('does not strip any populated Workspace-type fields', () => {
      const workspace = {
        ...baseWorkspace,
        name: 'compat-name',
        statusMessage: 'Working on it',
        activity: 'agent_running',
        skipWorktree: false,
        setupScript: 'pnpm install',
        isRemote: false,
        defaultModel: 'claude',
        agentSummary: { agentIds: ['agent-1'] },
        taskStats: { total: 1, completed: 0, inProgress: 1 },
        gitSummary: { ahead: 1, behind: 0, hasUnpushed: true },
        cowSupported: true,
        checkoutMode: 'worktree',
      };
      const parsed = WorkspaceSchema.parse(workspace);
      const strippedKeys = Object.keys(workspace).filter((key) => !(key in parsed));
      expect(strippedKeys).toEqual([]);
    });
  });

  describe('Safe Validation Functions', () => {
    it('should return success result for valid data', () => {
      const session = {
        id: 'agent-123',
        workspaceId: '550e8400-e29b-41d4-a716-446655440000',
        messages: [],
        status: 'active',
      };
      const result = safeValidateAgentSession(session);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(session);
      }
    });

    it('should return error result for invalid data', () => {
      const result = safeValidateAgentSession(null);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    it('should work for all safe validation functions', () => {
      expect(safeValidateAgentMessage(null).success).toBe(false);
      expect(safeValidateContentBlock(null).success).toBe(false);
      expect(safeValidateToolCall(null).success).toBe(false);
    });
  });
});
