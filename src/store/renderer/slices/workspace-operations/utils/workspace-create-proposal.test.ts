import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceCreateProposal } from '$shared/types/proposal';
import {
  buildCreateWorkspaceRequestFromProposal as buildRequest,
  type BuildCreateWorkspaceRequestOptions,
} from './workspace-create-proposal';

function makeProposal(params: Record<string, unknown>): WorkspaceCreateProposal {
  return {
    kind: 'workspace-create',
    payload: { operation: 'workspace.create', params },
    preview: { title: 'Create workspace' },
  };
}

// Independent model of the naming contract: a specialist's display name, or
// the generic "Agent" label for General (undefined) / unknown specialists.
const SPECIALIST_NAMES: Record<string, string> = {
  coordinator: 'Coordinator',
  implementor: 'Implementor',
  planner: 'Planner',
};
const resolveAgentName = (specialistId: string | undefined) =>
  (specialistId ? SPECIALIST_NAMES[specialistId] : undefined) ?? 'Agent';

function buildCreateWorkspaceRequestFromProposal(
  proposal: WorkspaceCreateProposal,
  editedFields: Record<string, unknown> | undefined,
  options: BuildCreateWorkspaceRequestOptions = { resolveAgentName },
) {
  return buildRequest(proposal, editedFields, options);
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
        name: 'Implementor',
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
          specialist: 'coordinator',
          prompt: 'Original prompt',
          agentType: 'task-breakdown',
          metadata: { isInitialAgent: false },
        },
      }),
      undefined,
    );

    expect(request.initialAgent).toMatchObject({
      name: 'Existing coordinator',
      specialist: 'coordinator',
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

  it('passes contextLinks through from proposal params (PROTOCOL §5.1)', () => {
    const contextLinks = [
      {
        kind: 'pr',
        url: 'https://github.com/acme/widgets/pull/42',
        owner: 'acme',
        repo: 'widgets',
        number: 42,
      },
    ];
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ repositoryPath: '/repo/local', baseRef: 'main', contextLinks }),
      undefined,
    );

    expect(request.contextLinks).toEqual(contextLinks);
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

  it('names the initial agent "Agent" when the resolved specialist is General', () => {
    const fromUndefined = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { prompt: 'Go' } }),
      undefined,
    );
    const fromNullEdit = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { prompt: 'Go', specialist: 'coordinator' } }),
      { specialist: null },
    );

    expect(fromUndefined.initialAgent?.name).toBe('Agent');
    expect(fromNullEdit.initialAgent?.name).toBe('Agent');
    expect(fromNullEdit.initialAgent?.specialist).toBeUndefined();
  });

  it('names the initial agent after the resolved specialist, honoring an edited override', () => {
    const fromPayload = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { prompt: 'Go', specialist: 'coordinator' } }),
      undefined,
    );
    const fromEdit = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { prompt: 'Go', specialist: 'coordinator' } }),
      { specialist: 'planner' },
    );

    expect(fromPayload.initialAgent).toMatchObject({
      name: 'Coordinator',
      specialist: 'coordinator',
    });
    expect(fromEdit.initialAgent).toMatchObject({ name: 'Planner', specialist: 'planner' });
  });

  it('keeps an explicit payload agent name when the specialist is unchanged', () => {
    const resolve = vi.fn(resolveAgentName);
    const fromPayload = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Named by producer', specialist: 'coordinator' } }),
      undefined,
      { resolveAgentName: resolve },
    );
    const fromSameEdit = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Named by producer', specialist: 'coordinator' } }),
      { specialist: 'coordinator' },
      { resolveAgentName: resolve },
    );

    expect(fromPayload.initialAgent).toMatchObject({
      name: 'Named by producer',
      specialist: 'coordinator',
    });
    expect(fromSameEdit.initialAgent).toMatchObject({
      name: 'Named by producer',
      specialist: 'coordinator',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('renames the initial agent after an edited specialist even when the payload names it', () => {
    // A sibling proposal hardcodes name "Coordinator" for its Coordinator
    // default; once the card applies another specialist the created agent must
    // not keep the stale name.
    const fromEdit = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', specialist: 'coordinator' } }),
      { specialist: 'implementor' },
    );
    const toGeneral = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', specialist: 'coordinator' } }),
      { specialist: null },
    );
    const fromUnnamedPayload = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', prompt: 'Go' } }),
      { specialist: 'planner' },
    );

    expect(fromEdit.initialAgent).toMatchObject({ name: 'Implementor', specialist: 'implementor' });
    expect(toGeneral.initialAgent?.name).toBe('Agent');
    expect(toGeneral.initialAgent?.specialist).toBeUndefined();
    expect(fromUnnamedPayload.initialAgent).toMatchObject({
      name: 'Planner',
      specialist: 'planner',
    });
  });

  it('renames a General edit on a payload that named no specialist', () => {
    // The daemon's sibling producer (workspace.rs) emits initialAgent
    // { name: 'Coordinator', prompt } with no specialist; a card that applies
    // General (null) must not create a General agent named "Coordinator".
    const resolve = vi.fn(resolveAgentName);
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', prompt: 'Go' } }),
      { specialist: null },
      { resolveAgentName: resolve },
    );

    expect(request.initialAgent?.name).toBe('Agent');
    expect(request.initialAgent?.specialist).toBeUndefined();
    expect(resolve).toHaveBeenCalledWith(undefined);
  });

  it('resolves the name for an unnamed-specialist payload even without a specialist edit', () => {
    // No payload specialist means the effective specialist is General, so the
    // payload name (written for another specialist) is never applicable.
    const resolve = vi.fn(resolveAgentName);
    const request = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', prompt: 'Go' } }),
      undefined,
      { resolveAgentName: resolve },
    );

    expect(request.initialAgent?.name).toBe('Agent');
    expect(request.initialAgent?.specialist).toBeUndefined();
    expect(resolve).toHaveBeenCalledWith(undefined);
  });

  it('treats an empty-string payload specialist as absent and resolves the name', () => {
    // `specialist: ""` names no specialist, so a payload name written for one
    // must not survive — neither with no edit nor with an unchanged "" edit.
    const resolve = vi.fn(resolveAgentName);
    const noEdit = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', prompt: 'Go', specialist: '' } }),
      undefined,
      { resolveAgentName: resolve },
    );
    const sameEmptyEdit = buildCreateWorkspaceRequestFromProposal(
      makeProposal({ initialAgent: { name: 'Coordinator', prompt: 'Go', specialist: '' } }),
      { specialist: '' },
      { resolveAgentName: resolve },
    );

    expect(noEdit.initialAgent?.name).toBe('Agent');
    expect(noEdit.initialAgent?.specialist).toBeUndefined();
    expect(noEdit.initialAgent?.metadata).not.toHaveProperty('specialist');
    expect(sameEmptyEdit.initialAgent?.name).toBe('Agent');
    expect(sameEmptyEdit.initialAgent?.metadata).not.toHaveProperty('specialist');
    expect(resolve).toHaveBeenCalledTimes(2);
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

  it('maps sibling edits exactly while keeping repository fields and idempotency locked', () => {
    const proposal: WorkspaceCreateProposal = {
      kind: 'workspace-create',
      payload: {
        operation: 'workspace.create',
        params: {
          idempotencyKey: 'sibling-proposal-1',
          title: 'Original follow-up',
          repositoryPath: '/repo/current',
          baseRef: 'main',
          scope: 'apps/current',
          isNewRepo: false,
          initialAgent: { prompt: 'Original prompt', specialist: 'planner' },
        },
      },
      preview: {
        title: 'Create sibling workspace',
        workspaceCreate: { mode: 'sibling', title: 'Original follow-up' },
      },
    };

    const request = buildCreateWorkspaceRequestFromProposal(proposal, {
      title: 'Edited follow-up',
      initialPrompt: 'Edited prompt',
      specialist: 'implementor',
      branch: 'feature/dependency',
      repoPath: '/repo/attacker',
      githubUrl: 'https://github.com/attacker/repo',
      clonePath: '/tmp/attacker',
      scope: 'apps/attacker',
      isNewRepo: true,
    });

    expect(request).toEqual({
      idempotencyKey: 'sibling-proposal-1',
      title: 'Edited follow-up',
      repositoryPath: '/repo/current',
      githubUrl: undefined,
      clonePath: undefined,
      baseRef: 'feature/dependency',
      scope: 'apps/current',
      isNewRepo: false,
      initialAgent: {
        name: 'Implementor',
        prompt: 'Edited prompt',
        specialist: 'implementor',
        agentType: 'workspace',
        metadata: { specialist: 'implementor', isInitialAgent: true },
      },
    });
  });
});
