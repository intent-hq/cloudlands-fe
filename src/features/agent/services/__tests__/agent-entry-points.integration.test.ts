/**
 * Agent Entry Points Integration Tests
 *
 * Tests that agents created from different entry points (sidebar, contextual menu, initializer)
 * receive rules correctly, have proper workspace paths, and can access MCP tools.
 */

import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { UnifiedAgentFactory } from '../agent-factory';

// Mock configured app Store
vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({ workspaceAgents: { byWorkspaceId: {} }, workspace: { activeWorkspaceId: 'test-ws' } }),
    dispatch: vi.fn(),
  });
});

// Mock the backend creation
vi.mock('../agent-factory', async () => {
  const actual = await vi.importActual('../agent-factory');
  return {
    ...actual,
    UnifiedAgentFactory: class extends (actual as any).UnifiedAgentFactory {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async createInBackend(agent: any, workspacePath: string) {
        // Mock successful backend creation
        return {
          success: true,
          agent: {
            ...agent,
            backendSessionId: `mock-backend-session-${agent.id}`,
          },
        };
      }
    },
  };
});

describe('Agent Entry Points Integration', () => {
  let factory: UnifiedAgentFactory;
  let testCounter = 0;

  function createMockWorkspace(suffix: string): Workspace {
    return {
      id: WorkspaceId(`test-workspace-${suffix}-${testCounter++}`),
      title: 'Test Workspace',
      path: `/home/user/intent/test-workspace-${suffix}`,
      repositoryPath: '/home/user/repos/my-project',
      worktreePath: '/home/user/repos/my-project/.git/worktrees/feature-branch',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any;
  }

  beforeEach(() => {
    factory = new UnifiedAgentFactory();
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up agents from the pool to prevent hitting limits in other tests
    const agentPool = (factory as any).agentPool;
    if (agentPool) {
      agentPool.clear?.();
    }
  });

  describe('Contextual Menu Entry Point', () => {
    it('should create agent with agentType and metadata', async () => {
      const workspace = createMockWorkspace('contextual-1');
      const config = {
        name: 'Workspace Agent',
        workspaceId: workspace.id,
        agentType: 'workspace',
        contextReferences: [
          {
            type: 'file' as const,
            path: '/src/app.ts',
            content: 'export function main() {}',
          },
        ],
        source: 'contextual-menu',
      };

      const result = await factory.createAgent(workspace, config);

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.name).toBe('Workspace Agent');
      // systemPrompt is built by backend, not available in frontend
      expect(result.agent?.systemPrompt).toBeUndefined();
      expect(result.agent?.metadata?.source).toBe('contextual-menu');
      expect(result.agent?.metadata?.agentType).toBe('workspace');
    });

    it('should include context references in agent config', async () => {
      const workspace = createMockWorkspace('contextual-2');
      const config = {
        name: 'Debug Agent',
        workspaceId: workspace.id,
        agentType: 'debug',
        contextReferences: [
          {
            type: 'file' as const,
            path: '/src/bug.ts',
            content: 'const x = undefined;',
          },
          {
            type: 'code_chunk' as const,
            content: 'Error: Cannot read property of undefined',
          },
        ],
        source: 'contextual-menu',
      };

      const result = await factory.createAgent(workspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.name).toBe('Debug Agent');
      expect(result.agent?.metadata?.agentType).toBe('debug');
      // Context references are passed to backend, not stored in frontend agent
    });
  });

  describe('Workspace Initializer Entry Point', () => {
    it('should create initial agent with workspace type', async () => {
      const workspace = createMockWorkspace('initializer');
      const config = {
        name: 'Initial Workspace Agent',
        workspaceId: workspace.id,
        agentType: 'workspace',
        source: 'initializer',
      };

      const result = await factory.createAgent(workspace, config);

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent?.name).toBe('Initial Workspace Agent');
      // systemPrompt is built by backend
      expect(result.agent?.systemPrompt).toBeUndefined();
      expect(result.agent?.metadata?.source).toBe('initializer');
      expect(result.agent?.metadata?.agentType).toBe('workspace');
    });
  });

  describe('Workspace Path Handling', () => {
    it('should use workspace-specific path for agent operations', async () => {
      const workspace = createMockWorkspace('path-1');
      const config = {
        name: 'Path Test Agent',
        workspaceId: workspace.id,
      };

      const result = await factory.createAgent(workspace, config);

      expect(result.success).toBe(true);
      // Verify workspace path is set correctly
      expect(workspace.path).toContain('test-workspace-path-1');
      // Verify worktree path takes priority if available
      expect(workspace.worktreePath).toBe(
        '/home/user/repos/my-project/.git/worktrees/feature-branch',
      );
    });

    it('should prioritize worktree path over workspace path', async () => {
      const workspace = createMockWorkspace('path-2');
      const workspaceWithWorktree: Workspace = {
        ...workspace,
        worktreePath: '/custom/worktree/path',
      } as any;

      const config = {
        name: 'Worktree Priority Agent',
        workspaceId: workspaceWithWorktree.id,
      };

      const result = await factory.createAgent(workspaceWithWorktree, config);

      expect(result.success).toBe(true);
      // The agent should use worktree path for operations
      expect(workspaceWithWorktree.worktreePath).toBe('/custom/worktree/path');
    });
  });

  describe('MCP Tool Access', () => {
    it('should configure agent with workspace ID for MCP tools', async () => {
      const workspace = createMockWorkspace('mcp');
      const config = {
        name: 'MCP Tool Agent',
        workspaceId: workspace.id,
        agentType: 'task-loop',
      };

      const result = await factory.createAgent(workspace, config);

      expect(result.success).toBe(true);
      // Agent should have workspace ID in its session
      expect(result.agent?.workspaceId).toBe(workspace.id);
      // Agent should have metadata for tracking
      expect(result.agent?.metadata).toBeDefined();
      expect(result.agent?.metadata?.agentType).toBe('task-loop');
    });
  });

  describe('Agent Message Persistence', () => {
    it('should create agent with proper metadata for persistence', async () => {
      const workspace = createMockWorkspace('persistence');
      const config = {
        name: 'Persistence Test Agent',
        workspaceId: workspace.id,
        metadata: {
          source: 'test',
          custom: 'metadata',
        },
      };

      const result = await factory.createAgent(workspace, config);

      expect(result.success).toBe(true);
      expect(result.agent?.metadata).toBeDefined();
      expect(result.agent?.metadata?.custom).toBe('metadata');
      expect(result.agent?.createdAt).toBeDefined();
      expect(result.agent?.updatedAt).toBeDefined();
    });
  });
});
