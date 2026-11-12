/**
 * Lets the hardware encoder move Home's workspace selection without importing
 * Home's components: the mounted Home page registers its list here.
 */

import type { PhysicalKnobDirection } from '$features/hardware-console/input/types';

export interface HomeEncoderTarget {
  /** Workspace ids in on-screen order, or null when the Workspaces list is not showing. */
  ids(): readonly string[] | null;
  /** The workspace whose side preview is open, or null. */
  selectedId(): string | null;
  /** Select a workspace, opening its side preview. */
  select(id: string): void;
}

let target: HomeEncoderTarget | null = null;

export function registerHomeEncoderTarget(next: HomeEncoderTarget): () => void {
  target = next;
  return () => {
    if (target === next) target = null;
  };
}

export function getHomeEncoderTarget(): HomeEncoderTarget | null {
  return target;
}

/** The rows Home's list view shows, top to bottom: expanded groups (or the flat list), then an open shelf. */
export function homeListOrder(input: {
  groups: readonly { expanded: boolean; items: readonly { id: string }[] }[];
  workspaces: readonly { id: string }[];
  aside: readonly { id: string }[];
  asideExpanded: boolean;
}): string[] {
  const main =
    input.groups.length > 0
      ? input.groups.filter((group) => group.expanded).flatMap((group) => group.items)
      : input.workspaces;
  return [...main, ...(input.asideExpanded ? input.aside : [])].map((workspace) => workspace.id);
}

/**
 * One detent: clockwise selects the next row down, counter-clockwise the one
 * above. With no visible selection either direction enters at the top.
 * Returns null at either end; the list does not wrap.
 */
export function stepHomeSelection(
  ids: readonly string[],
  selectedId: string | null,
  direction: PhysicalKnobDirection,
): string | null {
  if (ids.length === 0) return null;
  const index = selectedId === null ? -1 : ids.indexOf(selectedId);
  if (index === -1) return ids[0];
  return ids[index + (direction === 'clockwise' ? 1 : -1)] ?? null;
}
