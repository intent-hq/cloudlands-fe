import { omitKey } from "./utils";

type WorkspaceScopedState<T> = {
  byWorkspaceId: Record<string, T>;
};

export function createWorkspaceScopedHelpers<T>(emptyState: T) {
  const getWorkspaceState = <S extends WorkspaceScopedState<T>>(state: S, wsId: string): T => {
    return state.byWorkspaceId[wsId] ?? emptyState;
  };

  const setWorkspaceState = <S extends WorkspaceScopedState<T>>(
    state: S,
    wsId: string,
    workspaceState: T
  ): S => {
    return {
      ...state,
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [wsId]: workspaceState,
      },
    };
  };

  const clearWorkspaceState = <S extends WorkspaceScopedState<T>>(state: S, wsId: string): S => {
    const byWorkspaceId = omitKey(state.byWorkspaceId, wsId);
    if (byWorkspaceId === state.byWorkspaceId) {
      return state;
    }

    return {
      ...state,
      byWorkspaceId,
    };
  };

  return {
    getWorkspaceState,
    setWorkspaceState,
    clearWorkspaceState,
  };
}