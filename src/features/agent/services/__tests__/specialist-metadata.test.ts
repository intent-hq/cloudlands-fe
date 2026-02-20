/**
 * Specialist Metadata Tests
 *
 * Verifies that specialist metadata is properly stored and accessible.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedAgentFactory, agentFactory } from '../agent-factory';
import { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';

describe('Specialist Metadata', () => {
  let factory: UnifiedAgentFactory;

  beforeEach(() => {
    // Use the singleton instance
    factory = agentFactory;
    vi.clearAllMocks();
  });

  const createMockWorkspace = (id: string): Workspace => ({
    id: id as unknown as ReturnType<typeof WorkspaceId>,
    name: 'Test Workspace',
    path: `/tmp/test-workspace-${id}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('should store specialist in metadata when provided', async () => {
    const workspace = createMockWorkspace('specialist-1');
    const config = {
      name: 'Implementation Agent',
      workspaceId: workspace.id,
      metadata: {
        specialist: 'implementor',
      },
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBe('implementor');
  });

  it('should handle verifier specialist', async () => {
    const workspace = createMockWorkspace('specialist-2');
    const config = {
      name: 'Review Agent',
      workspaceId: workspace.id,
      metadata: {
        specialist: 'verifier',
      },
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBe('verifier');
  });

  it('should work without specialist metadata', async () => {
    const workspace = createMockWorkspace('specialist-3');
    const config = {
      name: 'Regular Agent',
      workspaceId: workspace.id,
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBeUndefined();
  });

  it('should preserve specialist alongside other metadata', async () => {
    const workspace = createMockWorkspace('specialist-4');
    const config = {
      name: 'Complex Agent',
      workspaceId: workspace.id,
      metadata: {
        specialist: 'implementor',
        source: 'test',
        custom: 'value',
      },
    };

    const result = await factory.createAgent(workspace, config);

    expect(result.success).toBe(true);
    expect(result.agent?.metadata?.specialist).toBe('implementor');
    expect(result.agent?.metadata?.source).toBe('test');
    expect(result.agent?.metadata?.custom).toBe('value');
  });
});
