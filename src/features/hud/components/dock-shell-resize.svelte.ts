import { untrack } from 'svelte';
import {
  DOCK_FLOATING_COMPACT_SIZE,
  getDockCompactNotchSize,
  type DockPlacementCommand,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';
import type { DockConversationSize } from './dock-conversation-resize-context';

interface DockShellResizeState {
  placement: DockPlacementSnapshot;
  gestureHeld?: boolean;
  width: number;
  height: number;
  railHeight: number;
  compactWingWidth: number;
  conversationVisible: boolean;
  conversationSize: DockConversationSize;
  /** Side conversation centre as an offset from the rail surface top; null centres it. */
  sidePanelAnchor?: number | null;
  expansionDirection: 'up' | 'down' | null;
  resizeToken: string | null;
}

/** Publish layout requests against the latest revision, including clamped replies. */
export function useDockShellResize(
  state: () => DockShellResizeState,
  command: (value: DockPlacementCommand) => void,
): void {
  let lastKey = '';
  $effect(() => {
    const current = state();
    const { placement, width, height, railHeight, compactWingWidth } = current;
    if (current.gestureHeld || placement.captureHidden || placement.phase === 'dragging') return;
    const request: DockPlacementCommand = {
      action: 'resize',
      width,
      height,
      revision: placement.revision,
      compactNotchWingWidth: compactWingWidth,
      sidePanelSize:
        placement.shape === 'edge' && current.conversationVisible
          ? { ...current.conversationSize }
          : null,
      ...(placement.shape === 'edge'
        ? {
            sidePanelAnchor: current.conversationVisible ? (current.sidePanelAnchor ?? null) : null,
          }
        : {}),
      expansionDirection: placement.shape === 'floating' ? current.expansionDirection : null,
      ...(current.resizeToken ? { resizeToken: current.resizeToken } : {}),
      landingSizes: {
        notch: getDockCompactNotchSize(placement.cutout, compactWingWidth),
        edge: { width: 40, height: railHeight },
        floating: DOCK_FLOATING_COMPACT_SIZE,
      },
    };
    untrack(() => {
      const key = JSON.stringify(request);
      if (lastKey === key) return;
      lastKey = key;
      command(request);
    });
  });
}
