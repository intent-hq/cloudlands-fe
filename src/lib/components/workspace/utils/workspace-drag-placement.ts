export type WorkspaceDragPlacement = 'before' | 'after' | 'above' | 'below';

interface DragTargetRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const STACK_HORIZONTAL_START = 0.25;
const STACK_HORIZONTAL_END = 0.75;
const STACK_VERTICAL_SIZE = 0.38;

export function getWorkspaceDragPlacement(
  clientX: number,
  clientY: number,
  rect: DragTargetRect,
): WorkspaceDragPlacement {
  const xRatio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const yRatio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  const isHorizontallyCentered = xRatio >= STACK_HORIZONTAL_START && xRatio <= STACK_HORIZONTAL_END;

  if (isHorizontallyCentered && yRatio <= STACK_VERTICAL_SIZE) return 'above';
  if (isHorizontallyCentered && yRatio >= 1 - STACK_VERTICAL_SIZE) return 'below';
  return xRatio < 0.5 ? 'before' : 'after';
}

export function isWorkspaceStackPlacement(
  placement: WorkspaceDragPlacement | null,
): placement is 'above' | 'below' {
  return placement === 'above' || placement === 'below';
}
