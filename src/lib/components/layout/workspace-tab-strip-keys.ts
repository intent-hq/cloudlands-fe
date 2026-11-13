export type WorkspaceTabKeyAction =
  /** No `targetId` when the tab is already at that end of the strip. */
  | { kind: 'move'; targetId?: string; placement: 'before' | 'after'; position: number }
  | { kind: 'close' }
  | { kind: 'select'; targetId: string };

type WorkspaceTabKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey'>;

/**
 * The strip action for a key pressed on tab `workspaceId`: Alt+Shift+Arrow
 * reorders, Delete or Mod+Backspace closes, and arrows, Home and End select
 * another tab, wrapping at the ends. Null for any other key.
 */
export function resolveWorkspaceTabKeyAction(
  event: WorkspaceTabKey,
  order: readonly string[],
  workspaceId: string,
): WorkspaceTabKeyAction | null {
  const index = order.indexOf(workspaceId);
  const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (event.altKey && event.shiftKey && step !== 0) {
    return {
      kind: 'move',
      targetId: index < 0 ? undefined : order[index + step],
      placement: step < 0 ? 'before' : 'after',
      position: index + step + 1,
    };
  }
  if (event.key === 'Delete' || (event.key === 'Backspace' && (event.metaKey || event.ctrlKey))) {
    return { kind: 'close' };
  }
  let targetId: string | undefined;
  if (step < 0) targetId = order[index - 1] ?? order.at(-1);
  if (step > 0) targetId = order[index + 1] ?? order[0];
  if (event.key === 'Home') targetId = order[0];
  if (event.key === 'End') targetId = order.at(-1);
  return targetId ? { kind: 'select', targetId } : null;
}
