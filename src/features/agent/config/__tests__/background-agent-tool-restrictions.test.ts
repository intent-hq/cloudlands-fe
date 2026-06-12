/**
 * Tests for Background Agent Tool Restrictions
 *
 * Verifies that background agents have appropriate tool denylists that:
 * 1. Prevent unintended side effects (file editing, git commits, etc.)
 * 2. Allow necessary tools for agents that need them
 * 3. Are correctly formatted with MCP tool suffixes
 */

import {
  describe,
  it,
  expect,
} from 'vitest';
import {
  BACKGROUND_AGENT_TOOL_DENYLISTS,
  FILE_WRITE_TOOLS,
  GIT_TOOLS,
  AGENT_CREATION_TOOLS,
  NOTE_WRITE_TOOLS,
  WORKSPACE_WRITE_TOOLS,
  UNIFIED_WORKSPACE_TOOLS,
  EXECUTION_TOOLS,
  EXTERNAL_TOOLS,
  getToolDenylistForAgentType,
  isBackgroundAgentType,
  getBackgroundAgentTypes,
} from '../background-agent-tool-restrictions';

describe('Background Agent Tool Restrictions', () => {
  describe('Tool Categories', () => {
    it('FILE_WRITE_TOOLS should contain all file modification tools', () => {
      expect(FILE_WRITE_TOOLS).toContain('str-replace-editor');
      expect(FILE_WRITE_TOOLS).toContain('save-file');
      expect(FILE_WRITE_TOOLS).toContain('remove-files');
      expect(FILE_WRITE_TOOLS).toContain('write_file_workspace-mcp');
      expect(FILE_WRITE_TOOLS).toContain('delete_file_workspace-mcp');
    });

    it('GIT_TOOLS should contain git modification tools but not git_status', () => {
      expect(GIT_TOOLS).toContain('git_stage_workspace-mcp');
      expect(GIT_TOOLS).toContain('git_commit_workspace-mcp');
      // git_status is read-only and should be allowed
      expect(GIT_TOOLS).not.toContain('git_status_workspace-mcp');
    });

    it('AGENT_CREATION_TOOLS should contain all agent spawning tools', () => {
      expect(AGENT_CREATION_TOOLS).toContain('create_agent_workspace-mcp');
      expect(AGENT_CREATION_TOOLS).toContain('delegate_task_workspace-mcp');
      expect(AGENT_CREATION_TOOLS).toContain('wake_or_create_task_agent_workspace-mcp');
    });

    it('NOTE_WRITE_TOOLS should contain note modification tools', () => {
      expect(NOTE_WRITE_TOOLS).toContain('create_note_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).toContain('set_note_content_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).toContain('add_to_note_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).toContain('edit_note_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).toContain('edit_note_lines_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).toContain('update_note_metadata_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).toContain('delete_note_workspace-mcp');
      // Should NOT contain read-only tools
      expect(NOTE_WRITE_TOOLS).not.toContain('read_note_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).not.toContain('list_notes_workspace-mcp');
      expect(NOTE_WRITE_TOOLS).not.toContain('list_note_tasks_workspace-mcp');
    });

    it('UNIFIED_WORKSPACE_TOOLS should contain bare and server-suffixed names', () => {
      expect(UNIFIED_WORKSPACE_TOOLS).toContain('workspace_api');
      expect(UNIFIED_WORKSPACE_TOOLS).toContain('workspace_api_workspace-mcp');
    });

    it('MCP tools should have _workspace-mcp suffix', () => {
      // Verify MCP tools follow the naming convention
      const mcpTools = [
        ...FILE_WRITE_TOOLS.filter((t) => t.includes('workspace-mcp')),
        ...GIT_TOOLS,
        ...AGENT_CREATION_TOOLS,
        ...NOTE_WRITE_TOOLS,
        ...WORKSPACE_WRITE_TOOLS,
      ];

      for (const tool of mcpTools) {
        expect(tool).toMatch(/_workspace-mcp$/);
      }
    });
  });

  describe('Background Agent Types', () => {
    it('should include all known background agent types', () => {
      const types = getBackgroundAgentTypes();
      expect(types).toContain('commit-message');
      expect(types).toContain('pr-description');
      expect(types).toContain('code-review');
      expect(types).toContain('code-walkthrough');
      expect(types).toContain('ralph-loop');
    });

    it('isBackgroundAgentType should correctly identify background agents', () => {
      expect(isBackgroundAgentType('commit-message')).toBe(true);
      expect(isBackgroundAgentType('code-review')).toBe(true);
      // chat and task-loop are now background agents with limited restrictions (only sub-agent denied)
      expect(isBackgroundAgentType('chat')).toBe(true);
      expect(isBackgroundAgentType('task-loop')).toBe(true);
      expect(isBackgroundAgentType('ralph-loop')).toBe(true);

      // Non-background agents
      expect(isBackgroundAgentType('workspace')).toBe(false);
      expect(isBackgroundAgentType('debug')).toBe(false);
      expect(isBackgroundAgentType('')).toBe(false);
    });
  });

  describe('Pure Text Generation Agents', () => {
    const textOnlyAgents = ['commit-message', 'pr-description', 'code-review', 'code-walkthrough'];

    for (const agentType of textOnlyAgents) {
      describe(agentType, () => {
        it('should deny all file write tools', () => {
          const denylist = getToolDenylistForAgentType(agentType);
          for (const tool of FILE_WRITE_TOOLS) {
            expect(denylist).toContain(tool);
          }
        });

        it('should deny all git tools', () => {
          const denylist = getToolDenylistForAgentType(agentType);
          for (const tool of GIT_TOOLS) {
            expect(denylist).toContain(tool);
          }
        });

        it('should deny all agent creation tools', () => {
          const denylist = getToolDenylistForAgentType(agentType);
          for (const tool of AGENT_CREATION_TOOLS) {
            expect(denylist).toContain(tool);
          }
        });

        it('should deny all execution tools', () => {
          const denylist = getToolDenylistForAgentType(agentType);
          for (const tool of EXECUTION_TOOLS) {
            expect(denylist).toContain(tool);
          }
        });

        it('should deny all external tools', () => {
          const denylist = getToolDenylistForAgentType(agentType);
          for (const tool of EXTERNAL_TOOLS) {
            expect(denylist).toContain(tool);
          }
        });

        it('should deny the unified workspace_api tool', () => {
          const denylist = getToolDenylistForAgentType(agentType);
          for (const tool of UNIFIED_WORKSPACE_TOOLS) {
            expect(denylist).toContain(tool);
          }
        });
      });
    }
  });

  describe('Interactive Agents', () => {
    const interactiveAgents = ['task-loop', 'ralph-loop', 'chat'];

    for (const agentType of interactiveAgents) {
      it(`${agentType} should retain workspace_api access`, () => {
        const denylist = getToolDenylistForAgentType(agentType);
        for (const tool of UNIFIED_WORKSPACE_TOOLS) {
          expect(denylist).not.toContain(tool);
        }
      });
    }
  });

  describe('Helper Functions', () => {
    it('getToolDenylistForAgentType returns empty array for unknown types', () => {
      expect(getToolDenylistForAgentType('unknown-type')).toEqual([]);
      expect(getToolDenylistForAgentType('')).toEqual([]);
    });

    it('getToolDenylistForAgentType returns readonly array', () => {
      const denylist = getToolDenylistForAgentType('commit-message');
      expect(Array.isArray(denylist)).toBe(true);
      expect(denylist.length).toBeGreaterThan(0);
    });
  });

  describe('Denylist Completeness', () => {
    it('all background agents should have non-empty denylists', () => {
      for (const [, denylist] of Object.entries(BACKGROUND_AGENT_TOOL_DENYLISTS)) {
        expect(denylist.length).toBeGreaterThan(0);
      }
    });

    it('denylists should not have duplicate entries', () => {
      for (const [, denylist] of Object.entries(BACKGROUND_AGENT_TOOL_DENYLISTS)) {
        const uniqueTools = new Set(denylist);
        expect(uniqueTools.size).toBe(denylist.length);
      }
    });
  });
});
