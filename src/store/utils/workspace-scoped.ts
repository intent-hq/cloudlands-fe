import { shallowEqual } from "fast-equals";

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
    workspaceState: T,
  ): S => {
    if (shallowEqual(state.byWorkspaceId[wsId], workspaceState)) {
      return state;
    }

    return {
      ...state,
      byWorkspaceId: {
        ...state.byWorkspaceId,
        [wsId]: workspaceState,
      },
    };
  };

  const clearWorkspaceState = <S extends WorkspaceScopedState<T>>(state: S, wsId: string): S => {
    if (!(wsId in state.byWorkspaceId)) {
      return state;
    }

    const { [wsId]: _removed, ...byWorkspaceId } = state.byWorkspaceId;
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
