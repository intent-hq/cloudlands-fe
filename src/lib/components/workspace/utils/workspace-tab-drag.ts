export interface WorkspaceTabSlot {
  id: string;
  centerX: number;
}

export interface WorkspaceTabMove {
  targetId: string;
  placement: 'before' | 'after';
}

export function getWorkspaceTabInsertionIndex(
  clientX: number,
  pointerOffsetX: number,
  draggedWidth: number,
  slots: WorkspaceTabSlot[],
): number {
  const draggedCenter = clientX - pointerOffsetX + draggedWidth / 2;
  const nextSlot = slots.findIndex((slot) => draggedCenter < slot.centerX);
  return nextSlot < 0 ? slots.length : nextSlot;
}

export function proposeWorkspaceTabOrder(
  order: string[],
  draggedId: string,
  insertionIndex: number,
): string[] {
  const remaining = order.filter((id) => id !== draggedId);
  const clampedIndex = Math.max(0, Math.min(insertionIndex, remaining.length));
  remaining.splice(clampedIndex, 0, draggedId);
  return remaining;
}

export function getReleasedWorkspaceTabMove(
  originalOrder: string[],
  proposedOrder: string[],
  draggedId: string,
): WorkspaceTabMove | null {
  if (originalOrder.join('\0') === proposedOrder.join('\0')) return null;
  const releasedIndex = proposedOrder.indexOf(draggedId);
  if (releasedIndex < 0) return null;
  const nextId = proposedOrder[releasedIndex + 1];
  if (nextId) return { targetId: nextId, placement: 'before' };
  const previousId = proposedOrder[releasedIndex - 1];
  return previousId ? { targetId: previousId, placement: 'after' } : null;
}
