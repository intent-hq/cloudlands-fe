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

  it('sends githubUrl + branch only (no clonePath/repositoryPath) for a picked repo', () => {
    // Pick-a-repo flow: githubUrl with no clone destination — the daemon
    // hydrates the checkout from its repo cache (PROTOCOL §5.1).
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({
        repositoryPath: 'acme/picked',
        githubUrl: 'https://github.com/acme/picked',
        baseRef: 'main',
        initialAgent: { prompt: 'Go' },
      }),
      { branch: 'develop' },
    );

    expect(request.githubUrl).toBe('https://github.com/acme/picked');
    expect(request.baseRef).toBe('develop');
    expect(request.clonePath).toBeUndefined();
    expect(request.repositoryPath).toBeUndefined();
  });

  it('keeps clonePath/repositoryPath for the explicit-clone GitHub flow', () => {
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({
        repositoryPath: '/clones/acme',
        githubUrl: 'https://github.com/acme/repo',
        clonePath: '/clones/acme',
        baseRef: 'main',
      }),
      undefined,
    );

    expect(request.githubUrl).toBe('https://github.com/acme/repo');
    expect(request.clonePath).toBe('/clones/acme');
    expect(request.repositoryPath).toBe('/clones/acme');
  });

  it('keeps repositoryPath for local repos with no githubUrl', () => {
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ repositoryPath: '/repo/local', baseRef: 'main' }),
      undefined,
    );

    expect(request.repositoryPath).toBe('/repo/local');
    expect(request.githubUrl).toBeUndefined();
    expect(request.clonePath).toBeUndefined();
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
