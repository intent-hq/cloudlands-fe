import type { Workspace } from '$shared/types';

export type WorkspaceTitleMutationToken = number;

type WorkspaceTitleMutation = {
  token: WorkspaceTitleMutationToken;
  optimisticTitle: string;
  previousTitle: string;
  acknowledged: boolean;
  observedMatchingSnapshot: boolean;
};

export type WorkspaceTitleMutationFailure = Pick<
  WorkspaceTitleMutation,
  'optimisticTitle' | 'previousTitle'
>;

const mutations = new Map<string, WorkspaceTitleMutation>();
let nextToken = 0;

export function beginWorkspaceTitleMutation(
  workspaceId: string,
  optimisticTitle: string,
  previousTitle: string,
): WorkspaceTitleMutationToken {
  const current = mutations.get(workspaceId);
  const token = ++nextToken;
  mutations.set(workspaceId, {
    token,
    optimisticTitle,
    previousTitle: current?.optimisticTitle ?? previousTitle,
    acknowledged: false,
    observedMatchingSnapshot: false,
  });
  return token;
}

export function acknowledgeWorkspaceTitleMutation(
  workspaceId: string,
  token: WorkspaceTitleMutationToken,
  authoritativeTitle: string,
): boolean {
  const current = mutations.get(workspaceId);
  if (current?.token !== token) return false;
  if (current.observedMatchingSnapshot && current.optimisticTitle === authoritativeTitle) {
    mutations.delete(workspaceId);
    return true;
  }
  mutations.set(workspaceId, {
    ...current,
    optimisticTitle: authoritativeTitle,
    acknowledged: true,
    observedMatchingSnapshot: false,
  });
  return true;
}

export function failWorkspaceTitleMutation(
  workspaceId: string,
  token: WorkspaceTitleMutationToken,
): WorkspaceTitleMutationFailure | undefined {
  const current = mutations.get(workspaceId);
  if (current?.token !== token) return undefined;
  mutations.delete(workspaceId);
  return {
    optimisticTitle: current.optimisticTitle,
    previousTitle: current.previousTitle,
  };
}

export function applyWorkspaceTitleMutationOverlay(workspaces: Workspace[]): Workspace[] {
  const snapshotIds = new Set(workspaces.map((workspace) => String(workspace.id)));
  for (const workspaceId of mutations.keys()) {
    if (!snapshotIds.has(workspaceId)) mutations.delete(workspaceId);
  }

  return workspaces.map((workspace) => {
    const workspaceId = String(workspace.id);
    const current = mutations.get(workspaceId);
    if (!current) return workspace;
    if (workspace.title === current.optimisticTitle) {
      if (current.acknowledged) mutations.delete(workspaceId);
      else mutations.set(workspaceId, { ...current, observedMatchingSnapshot: true });
      return workspace;
    }
    return { ...workspace, title: current.optimisticTitle };
  });
}

export function resetWorkspaceTitleMutationsForTests(): void {
  mutations.clear();
  nextToken = 0;
}
