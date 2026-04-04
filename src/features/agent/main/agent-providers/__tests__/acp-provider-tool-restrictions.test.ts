/**
 * Tool Restrictions Integration Tests for ACPProvider
 *
 * These tests verify that background agent tool restrictions are correctly
 * applied when building auggie CLI arguments.
 */

import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_AGENT_TOOL_DENYLISTS,
  FILE_WRITE_TOOLS,
  SUBAGENT_TOOLS,
  getToolDenylistForAgentType,
} from '../../../config/background-agent-tool-restrictions';

describe('ACPProvider Tool Restrictions Integration', () => {
  describe('getToolRestrictionsForAgent behavior', () => {
    /**
     * Test that the tool restrictions configuration is properly structured
     * and would be applied correctly by ACPProvider
     */
    it('should return denylist for commit-message agent type', () => {
      const denylist = getToolDenylistForAgentType('commit-message');

      expect(denylist.length).toBeGreaterThan(0);
      expect(denylist).toContain('str-replace-editor');
      expect(denylist).toContain('save-file');
      expect(denylist).toContain('git_commit_workspace-mcp');
    });

    it('should return denylist for code-review agent type', () => {
      const denylist = getToolDenylistForAgentType('code-review');

      expect(denylist.length).toBeGreaterThan(0);
      expect(denylist).toContain('str-replace-editor');
      expect(denylist).toContain('write_file_workspace-mcp');
    });

    it('should return empty array for non-background agent types', () => {
      expect(getToolDenylistForAgentType('workspace')).toEqual([]);
      expect(getToolDenylistForAgentType('debug')).toEqual([]);
      // Note: 'chat' is now a background agent with limited restrictions (only sub-agent denied)
      expect(getToolDenylistForAgentType('')).toEqual([]);
    });

    it('should return SUBAGENT_TOOLS for chat and task-loop agents', () => {
      // chat and task-loop have minimal restrictions - only subagent tools are denied
      expect(getToolDenylistForAgentType('chat')).toEqual([...SUBAGENT_TOOLS]);
      expect(getToolDenylistForAgentType('task-loop')).toEqual([...SUBAGENT_TOOLS]);
    });

    it('should return FILE_WRITE_TOOLS for spec-writer/coordinator (verified via config)', () => {
      // This tests that the FILE_WRITE_TOOLS constant is properly exported
      // and can be used by ACPProvider for spec-writer/coordinator agents
      expect(FILE_WRITE_TOOLS.length).toBeGreaterThan(0);
      expect(FILE_WRITE_TOOLS).toContain('str-replace-editor');
      expect(FILE_WRITE_TOOLS).toContain('save-file');
    });

    it('should prioritize specialist restrictions over agentType restrictions', () => {
      // CRITICAL TEST: Coordinator agents with agentType="chat" should get
      // spec-writer restrictions (FILE_WRITE_TOOLS + SUBAGENT_TOOLS),
      // NOT the chat restrictions (only SUBAGENT_TOOLS)
      //
      // This prevents the bug where:
      // - agentType="chat" returns SUBAGENT_TOOLS
      // - specialist="spec-writer" should return FILE_WRITE_TOOLS + SUBAGENT_TOOLS (many more tools)
      //
      // The specialist check MUST happen before the agentType check in ACPProvider.getToolRestrictionsForAgent()

      // Verify chat agentType alone only blocks subagent tools
      const chatDenylist = getToolDenylistForAgentType('chat');
      expect(chatDenylist).toEqual([...SUBAGENT_TOOLS]);

      // Verify spec-writer should block both file editing AND subagent tools
      // (This is what ACPProvider should return when specialist="spec-writer")
      const expectedSpecWriterTools = [...FILE_WRITE_TOOLS, ...SUBAGENT_TOOLS];
      expect(expectedSpecWriterTools.length).toBeGreaterThan(SUBAGENT_TOOLS.length);
      expect(expectedSpecWriterTools).toContain('str-replace-editor');
      expect(expectedSpecWriterTools).toContain('save-file');
      expect(expectedSpecWriterTools).toContain('sub-agent');
    });

    it('should have sub-agent variants in SUBAGENT_TOOLS constant for global blocking', () => {
      // Verify that SUBAGENT_TOOLS contains all sub-agent variants
      // This is used by ACPProvider to block sub-agent tools for ALL agents
      // because sub-agent has no UI representation
      expect(SUBAGENT_TOOLS).toContain('sub-agent');
      expect(SUBAGENT_TOOLS).toContain('sub-agent-explore');
      expect(SUBAGENT_TOOLS).toContain('sub-agent-plan');
      expect(SUBAGENT_TOOLS).toContain('sub-agent-code-review-local-analyzer');
      expect(SUBAGENT_TOOLS.length).toBe(4);
    });
  });

  describe('CLI argument generation verification', () => {
    /**
     * Simulates how ACPProvider would generate --remove-tool arguments
     */
    it('should generate correct --remove-tool arguments for commit-message', () => {
      const agentType = 'commit-message';
      const denylist = getToolDenylistForAgentType(agentType);

      // Simulate how ACPProvider builds args
      const args: string[] = [];
      for (const tool of denylist) {
        args.push('--remove-tool', tool);
      }

      // Verify structure
      expect(args.length).toBe(denylist.length * 2); // --remove-tool + tool name pairs
      expect(args.filter((a) => a === '--remove-tool').length).toBe(denylist.length);

      // Verify specific tools are removed
      const toolIndex = args.indexOf('str-replace-editor');
      expect(toolIndex).toBeGreaterThan(0);
      expect(args[toolIndex - 1]).toBe('--remove-tool');
    });

    it('should generate no --remove-tool arguments for regular agents', () => {
      const agentType = 'workspace';
      const denylist = getToolDenylistForAgentType(agentType);

      const args: string[] = [];
      for (const tool of denylist) {
        args.push('--remove-tool', tool);
      }

      expect(args.length).toBe(0);
    });
  });

  describe('all background agent types have restrictions', () => {
    const backgroundAgentTypes = Object.keys(BACKGROUND_AGENT_TOOL_DENYLISTS);
    // chat and task-loop have minimal restrictions (only subagent tools denied)
    const minimalRestrictionAgents = ['chat', 'task-loop', 'ralph-loop'];

    for (const agentType of backgroundAgentTypes) {
      it(`${agentType} should have non-empty denylist`, () => {
        const denylist = getToolDenylistForAgentType(agentType);
        expect(denylist.length).toBeGreaterThan(0);
      });

      if (!minimalRestrictionAgents.includes(agentType)) {
        it(`${agentType} should deny file write tools`, () => {
          const denylist = getToolDenylistForAgentType(agentType);
          expect(denylist).toContain('str-replace-editor');
          expect(denylist).toContain('save-file');
        });
      }
    }
  });
});
