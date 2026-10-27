import type { DockPointerRect } from '$shared/dock-layout';
import type { DockPlacementSnapshot } from '$shared/dock-placement';
import type { DockConversationSize, DockResizeEdge } from './dock-conversation-resize-context';

export function conversationResizeRect(
  state: DockPlacementSnapshot,
  header: number,
): DockPointerRect {
  if (state.placement.kind === 'edge' && state.sidePanel) return state.sidePanel;
  const up = state.shape === 'floating' && state.expansionDirection === 'up';
  return {
    ...state.surface,
    y: state.surface.y + (up ? 0 : header),
    height: Math.max(1, state.surface.height - header),
  };
}

function centerX(state: DockPlacementSnapshot): number {
  const anchor = state.floatingAnchor;
  if (state.shape === 'floating' && anchor) return anchor.x + anchor.width / 2;
  if (state.cutout) return state.cutout.x + state.cutout.width / 2;
  const area = state.workArea ?? state.surface;
  return area.x + area.width / 2;
}

/** Invert the native centered-then-clamped resolver, including a clamp transition. */
function centeredSize(
  edge: number,
  center: number,
  low: number,
  high: number,
  leading: boolean,
): number {
  return leading
    ? Math.min(2 * (center - edge), high - edge)
    : Math.min(2 * (edge - center), edge - low);
}

export function conversationSizeAtPointer(
  state: DockPlacementSnapshot,
  header: number,
  edge: DockResizeEdge,
  screen: { x: number; y: number },
): DockConversationSize {
  const rect = conversationResizeRect(state, header);
  const area = state.workArea ?? {
    x: 0,
    y: 0,
    width: state.windowBounds.width,
    height: state.windowBounds.height,
  };
  const x = screen.x - state.windowBounds.x;
  const y = screen.y - state.windowBounds.y;
  let width = rect.width;
  let height = rect.height;
  if (/[ew]/.test(edge)) {
    width =
      state.placement.kind === 'edge'
        ? edge.includes('w')
          ? rect.x + rect.width - x
          : x - rect.x
        : centeredSize(x, centerX(state), area.x, area.x + area.width, edge.includes('w'));
  }
  if (/[ns]/.test(edge)) {
    height =
      state.placement.kind === 'edge'
        ? centeredSize(
            y,
            state.surface.y + state.surface.height / 2,
            area.y,
            area.y + area.height,
            edge.includes('n'),
          )
        : edge.includes('n')
          ? rect.y + rect.height - y
          : y - rect.y;
  }
  return { width, height };
}

export function conversationResizeEdges(
  state: DockPlacementSnapshot,
  header: number,
): DockResizeEdge[] {
  const rect = conversationResizeRect(state, header);
  const area = state.workArea;
  const side = state.placement.kind === 'edge' ? state.placement.side : null;
  const idealX = centerX(state) - rect.width / 2;
  const west = side ? side === 'right' : !area || idealX >= area.x - 0.5;
  const east = side ? side === 'left' : !area || idealX + rect.width <= area.x + area.width + 0.5;
  const idealY = state.surface.y + (state.surface.height - rect.height) / 2;
  const up = state.shape === 'floating' && state.expansionDirection === 'up';
  const north = side ? !area || idealY >= area.y - 0.5 : up;
  const south = side ? !area || idealY + rect.height <= area.y + area.height + 0.5 : !up;
  const edges: DockResizeEdge[] = [];
  if (west) edges.push('w');
  if (east) edges.push('e');
  if (north) edges.push('n');
  if (south) edges.push('s');
  if (north && west) edges.push('nw');
  if (north && east) edges.push('ne');
  if (south && west) edges.push('sw');
  if (south && east) edges.push('se');
  return edges;
}
