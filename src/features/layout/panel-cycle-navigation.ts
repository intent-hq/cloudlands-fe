export type PanelCycleDirection = 'next' | 'prev';

export interface PanelCycleBoundaryTarget {
  workspaceId: string;
  layoutId: string;
}

export function resolveLocalPanelCycleTarget(
  panelIds: string[],
  focusedPanelId: string | null,
  direction: PanelCycleDirection,
): string | null {
  if (panelIds.length === 0) return null;

  const currentIndex = focusedPanelId ? panelIds.indexOf(focusedPanelId) : -1;
  if (currentIndex === -1) {
    return direction === 'next' ? panelIds[0] : panelIds[panelIds.length - 1];
  }

  const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
  return panelIds[nextIndex] ?? null;
}

export function findAdjacentWorkspaceWithPanels(
  workspaceStacks: string[][],
  currentWorkspaceId: string,
  direction: PanelCycleDirection,
  hasPanels: (workspaceId: string) => boolean,
): string | null {
  const workspaceIds = workspaceStacks.flat();
  const currentIndex = workspaceIds.indexOf(currentWorkspaceId);
  if (currentIndex === -1 || workspaceIds.length <= 1) return null;

  const step = direction === 'next' ? 1 : -1;
  for (let offset = 1; offset < workspaceIds.length; offset += 1) {
    const candidateIndex =
      (currentIndex + step * offset + workspaceIds.length) % workspaceIds.length;
    const candidateId = workspaceIds[candidateIndex];
    if (hasPanels(candidateId)) return candidateId;
  }

  return null;
}
