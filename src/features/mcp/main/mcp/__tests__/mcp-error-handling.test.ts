/**
 * Tests for MCP error handling
 * Verifies that tool errors are properly converted to MCP error responses
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted to ensure mock is set up before any imports
const mockProvenanceManager = vi.hoisted(() => ({
  getProvenanceContextManager: vi.fn(() => ({
    getCurrentContext: vi.fn(() => null),
    createAgentContext: vi.fn(() => 'mock-context-id'),
    clearContext: vi.fn(),
    popContext: vi.fn(),
  })),
}));

// Mock using the path that will be resolved from workspace-tools.ts (re-exported tools)
vi.mock(
  '$features/workspace/main/provenance/provenance-context-manager',
  () => mockProvenanceManager,
);

import { MCPServer } from '../server';
import { CreateNoteTool } from '../workspace-tools';
import { ToolCall, ToolResult } from '../protocol';

describe('MCP Error Handling', () => {
  let server: MCPServer;
  let mockWorkspaceManager: any;

  beforeEach(() => {
    server = new MCPServer({
      name: 'Test MCP Server',
      version: '1.0.0',
    });

    mockWorkspaceManager = {
      createNote: vi.fn(),
      listNotes: vi.fn(),
      getNote: vi.fn(),
      updateNote: vi.fn(),
      deleteNote: vi.fn(),
    };
  });

  describe('CreateNoteTool error handling', () => {
    it('should return error result when title is missing', async () => {
      const tool = new CreateNoteTool(mockWorkspaceManager, 'workspace-1');
      const call: ToolCall = {
        name: 'create_note',
        arguments: {
          content: 'Test content',
          // title is missing
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
      expect((result.content[0] as any).text).toContain('Title and content are required');
    });

    it('should return error result when workspace manager is not available', async () => {
      const tool = new CreateNoteTool(null, 'workspace-1');
      const call: ToolCall = {
        name: 'create_note',
        arguments: {
          title: 'Test Note',
          content: 'Test content',
        },
      };

      const result = await tool.execute(call);

      expect(result.isError).toBe(true);
      expect((result.content[0] as any).text).toContain('Workspace manager not available');
    });

    it('should successfully create a note', async () => {
      const mockNote = {
        id: 'note-123',
        title: 'Test Note',
        content: 'Test content',
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockWorkspaceManager.createNote.mockResolvedValue(mockNote);

      const tool = new CreateNoteTool(mockWorkspaceManager, 'workspace-1');
      const call: ToolCall = {
        name: 'create_note',
        arguments: {
          title: 'Test Note',
          content: 'Test content',
        },
      };

      const result = await tool.execute(call);

      // The tool should now succeed since we fixed the provenance-context-manager import
      expect(result.isError).toBe(false);
      expect(mockWorkspaceManager.createNote).toHaveBeenCalledWith('workspace-1', {
        title: 'Test Note',
        content: 'Test content',
        tags: [],
        metadata: {
          author: {
            id: 'agent',
            name: 'Agent',
            type: 'agent',
          },
        },
      });
    });
  });

  describe('MCPServer error response conversion', () => {
    it('should convert tool error result to MCP error response', async () => {
      const tool = new CreateNoteTool(null, 'workspace-1');
      server.registerTool(tool);

      const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_note',
          arguments: {
            title: 'Test',
            // content is missing
          },
        },
      });

      expect(response).toBeDefined();
      expect(response && 'error' in response).toBe(true);
      expect((response as any).error).toBeDefined();
      expect((response as any).error.message).toContain('Title and content are required');
    });

    it('should return successful response for successful tool execution', async () => {
      const mockNote = {
        id: 'note-123',
        title: 'Test Note',
        content: 'Test content',
        tags: [],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockWorkspaceManager.createNote.mockResolvedValue(mockNote);

      const tool = new CreateNoteTool(mockWorkspaceManager, 'workspace-1');
      server.registerTool(tool);

      const response = await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_note',
          arguments: {
            title: 'Test Note',
            content: 'Test content',
          },
        },
      });

      expect(response).toBeDefined();
      // The tool should now succeed since we fixed the provenance-context-manager import
      expect(response && 'result' in response).toBe(true);
      expect((response as any).result).toBeDefined();
    });
  });
});
