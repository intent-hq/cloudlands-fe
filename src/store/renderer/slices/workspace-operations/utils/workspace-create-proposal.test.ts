import { describe, expect, it } from 'vitest';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';
import { buildCreateWorkspaceRequestFromProposal } from './workspace-create-proposal';

function makeProposal(params: Record<string, unknown>): WorkspaceCreateProposal {
  return {
    kind: 'workspace-create',
    payload: { operation: 'workspace.create', params },
    preview: { title: 'Create workspace' },
  };
}

describe('buildCreateWorkspaceRequestFromProposal', () => {
  it('overrides create params from edited workspace fields', () => {
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({
        repositoryPath: '/repo/original',
        githubUrl: 'https://github.com/acme/original',
        clonePath: '/clone/original',
        baseRef: 'main',
        isNewRepo: false,
        scope: 'old-scope',
        initialAgent: {
          prompt: 'Original prompt',
          specialist: 'planner',
          metadata: { provider: 'auggie', workMode: 'single' },
        },
      }),
      {
        repoPath: '/repo/edited',
        githubUrl: 'https://github.com/acme/edited',
        clonePath: '/clone/edited',
        branch: 'feature/apply',
        isNewRepo: true,
        scope: 'packages/app',
        initialPrompt: 'Edited prompt',
        specialist: 'implementor',
      },
    );

    expect(request).toMatchObject({
      repositoryPath: '/repo/edited',
      githubUrl: 'https://github.com/acme/edited',
      clonePath: '/clone/edited',
      baseRef: 'feature/apply',
      isNewRepo: true,
      scope: 'packages/app',
      initialAgent: {
        name: 'Coordinator',
        prompt: 'Edited prompt',
        specialist: 'implementor',
        agentType: 'workspace',
        metadata: {
          provider: 'auggie',
          workMode: 'single',
          specialist: 'implementor',
          isInitialAgent: true,
        },
      },
    });
    // The daemon assigns the initial agent's id — the request must not carry one.
    expect(request.initialAgent?.agentId).toBeUndefined();
  });

  it('strips a client-supplied initial agent id and defaults missing fields', () => {
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({
        repositoryPath: '/repo/original',
        initialAgent: {
          agentId: 'agent-existing',
          name: 'Existing coordinator',
          prompt: 'Original prompt',
          agentType: 'task-breakdown',
          metadata: { isInitialAgent: false },
        },
      }),
      undefined,
    );

    expect(request.initialAgent).toMatchObject({
      name: 'Existing coordinator',
      prompt: 'Original prompt',
      agentType: 'task-breakdown',
      metadata: { isInitialAgent: true },
    });
    // Even a proposal payload carrying an id must not forward it on the wire.
    expect(request.initialAgent?.agentId).toBeUndefined();
  });

  it('clears specialist metadata when specialist edit is null', () => {
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({
        initialAgent: {
          prompt: 'Original prompt',
          specialist: 'planner',
          metadata: { provider: 'auggie', specialist: 'planner' },
        },
      }),
      { specialist: null },
    );

    expect(request.initialAgent?.specialist).toBeUndefined();
    expect(request.initialAgent?.metadata).toEqual({
      provider: 'auggie',
      isInitialAgent: true,
    });
  });

  it('preserves existing specialist metadata when specialist edit is absent', () => {
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({
        initialAgent: {
          prompt: 'Original prompt',
          specialist: 'planner',
          metadata: { provider: 'auggie', specialist: 'planner' },
        },
      }),
      {},
    );

    expect(request.initialAgent).toMatchObject({
      specialist: 'planner',
      metadata: {
        provider: 'auggie',
        specialist: 'planner',
        isInitialAgent: true,
      },
    });
  });
});
