interface RetainedWorkspaceSurface {
  workspaceId: string;
  generation: number;
  lastActive: number;
  hadEntity: boolean;
}

export interface WorkspaceSurfaceRetentionState {
  activeWorkspaceId: string | null;
  nextSequence: number;
  // eslint-disable-next-line themis/collection-state-shape -- Bounded component-local cache, not Redux state.
  surfaces: RetainedWorkspaceSurface[];
}

export function createWorkspaceSurfaceRetentionState(): WorkspaceSurfaceRetentionState {
  return { activeWorkspaceId: null, nextSequence: 1, surfaces: [] };
}

export function reconcileWorkspaceSurfaces(
  state: WorkspaceSurfaceRetentionState,
  input: {
    activeWorkspaceId: string;
    openWorkspaceIds: readonly string[];
    workspaceEntityIds: readonly string[];
  },
): WorkspaceSurfaceRetentionState {
  const { activeWorkspaceId } = input;
  const openWorkspaceIds = new Set(input.openWorkspaceIds);
  const workspaceEntityIds = new Set(input.workspaceEntityIds);
  let nextSequence = state.nextSequence;
  const continuesCreationSurface =
    state.activeWorkspaceId !== null &&
    isCreationWorkspaceId(state.activeWorkspaceId) &&
    state.activeWorkspaceId !== activeWorkspaceId &&
    !state.surfaces.some((surface) => surface.workspaceId === activeWorkspaceId);
  let surfaces = state.surfaces
    .map((surface) =>
      continuesCreationSurface && surface.workspaceId === state.activeWorkspaceId
        ? {
            ...surface,
            workspaceId: activeWorkspaceId,
            hadEntity: workspaceEntityIds.has(activeWorkspaceId),
          }
        : surface,
    )
    .filter(
      (surface) =>
        surface.workspaceId === activeWorkspaceId || openWorkspaceIds.has(surface.workspaceId),
    )
    .filter(
      (surface) =>
        surface.workspaceId === activeWorkspaceId ||
        !surface.hadEntity ||
        workspaceEntityIds.has(surface.workspaceId),
    )
    .map((surface) => ({
      ...surface,
      hadEntity: surface.hadEntity || workspaceEntityIds.has(surface.workspaceId),
    }));

  let activeSurface = surfaces.find((surface) => surface.workspaceId === activeWorkspaceId);
  if (activeSurface?.hadEntity && !workspaceEntityIds.has(activeWorkspaceId)) {
    const generation = nextSequence++;
    surfaces = surfaces.map((surface) =>
      surface === activeSurface ? { ...surface, generation, hadEntity: false } : surface,
    );
    activeSurface = surfaces.find((surface) => surface.workspaceId === activeWorkspaceId);
  }

  if (!activeSurface) {
    const generation = nextSequence++;
    activeSurface = {
      workspaceId: activeWorkspaceId,
      generation,
      lastActive: generation,
      hadEntity: workspaceEntityIds.has(activeWorkspaceId),
    };
    surfaces = [...surfaces, activeSurface];
  } else if (state.activeWorkspaceId !== activeWorkspaceId) {
    const lastActive = nextSequence++;
    surfaces = surfaces.map((surface) =>
      surface === activeSurface ? { ...surface, lastActive } : surface,
    );
  }

  const inactive = surfaces
    .filter((surface) => surface.workspaceId !== activeWorkspaceId)
    .sort((left, right) => right.lastActive - left.lastActive)[0];
  surfaces = surfaces.filter(
    (surface) => surface.workspaceId === activeWorkspaceId || surface === inactive,
  );

  const next = { activeWorkspaceId, nextSequence, surfaces };
  return retentionStatesEqual(state, next) ? state : next;
}

function isCreationWorkspaceId(workspaceId: string): boolean {
  return workspaceId === 'new' || workspaceId.startsWith('optimistic-');
}

function retentionStatesEqual(
  left: WorkspaceSurfaceRetentionState,
  right: WorkspaceSurfaceRetentionState,
): boolean {
  return (
    left.activeWorkspaceId === right.activeWorkspaceId &&
    left.nextSequence === right.nextSequence &&
    left.surfaces.length === right.surfaces.length &&
    left.surfaces.every((surface, index) => {
      const other = right.surfaces[index];
      return (
        surface.workspaceId === other.workspaceId &&
        surface.generation === other.generation &&
        surface.lastActive === other.lastActive &&
        surface.hadEntity === other.hadEntity
      );
    })
  );
}
