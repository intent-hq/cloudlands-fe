import { onDestroy, tick, untrack } from 'svelte';
import {
  DOCK_CONVERSATION_DEFAULT_SIZE,
  DOCK_CONVERSATION_MIN_SIZE,
  DOCK_SURFACE_MAX_SIZE,
  type DockPlacementCommand,
  type DockPlacementSnapshot,
} from '$shared/dock-placement';
import {
  setDockConversationResize,
  type DockConversationSize,
  type DockResizeEdge,
} from './dock-conversation-resize-context';
import {
  conversationResizeEdges,
  conversationResizeRect,
  conversationSizeAtPointer,
} from './dock-conversation-resize-geometry';

/** Remember expanded content dimensions without changing the compact placement. */
export function useDockConversationResize(
  snapshot: () => DockPlacementSnapshot,
  selected: () => boolean,
  headerHeight: () => number,
  startResult: () => { id: number; token: string | null } | null | undefined,
  command: (value: DockPlacementCommand) => void,
) {
  let size = $state<DockConversationSize>({ ...DOCK_CONVERSATION_DEFAULT_SIZE });
  let held = $state(false);
  let direction = $state<'up' | 'down' | null>(null);
  let token = $state<string | null>(null);
  let awaiting: { after: number; cancelled: boolean } | null = null;
  let original: {
    size: DockConversationSize;
    direction: 'up' | 'down' | null;
    generation: number;
  } | null = null;
  let generation = 0;
  let queuedSize: DockConversationSize | null = null;
  let ending = false;
  let disposed = false;
  const enabled = () => selected() && !snapshot().captureHidden && snapshot().phase === 'idle';
  const maximum = (): DockConversationSize => {
    const state = snapshot();
    const area = state.workArea;
    if (!area)
      return { width: DOCK_SURFACE_MAX_SIZE, height: DOCK_SURFACE_MAX_SIZE - headerHeight() };
    if (state.placement.kind === 'edge') {
      const width =
        state.placement.side === 'left'
          ? area.x + area.width - state.surface.x - state.surface.width - 8
          : state.surface.x - 8 - area.x;
      return {
        width: Math.max(1, Math.min(DOCK_SURFACE_MAX_SIZE, width)),
        height: Math.max(1, Math.min(DOCK_SURFACE_MAX_SIZE, area.height)),
      };
    }
    const anchor = state.floatingAnchor ?? state.surface;
    const up = state.shape === 'floating' && (direction ?? state.expansionDirection) === 'up';
    const height = up
      ? anchor.y + anchor.height - area.y - headerHeight()
      : area.y + area.height - anchor.y - headerHeight();
    return {
      width: Math.min(DOCK_SURFACE_MAX_SIZE, area.width),
      height: Math.max(1, Math.min(DOCK_SURFACE_MAX_SIZE - headerHeight(), height)),
    };
  };
  const minimum = (): DockConversationSize => {
    const max = maximum();
    return {
      width: Math.min(max.width, DOCK_CONVERSATION_MIN_SIZE.width),
      height: Math.min(max.height, DOCK_CONVERSATION_MIN_SIZE.height),
    };
  };
  function lockDirection(): void {
    if (snapshot().shape === 'floating') direction ??= snapshot().expansionDirection ?? 'down';
  }
  function restore(): void {
    if (!original) return;
    size = { ...original.size };
    direction = original.generation === generation ? original.direction : null;
  }
  function end(cancel: boolean): void {
    if (ending) return;
    held = false;
    if (awaiting) {
      awaiting.cancelled = true;
      queuedSize = null;
      restore();
      return;
    }
    if (!token) return;
    const current = token;
    if (cancel) restore();
    ending = true;
    // Let the final size request enter the serialized bridge before ending ownership.
    void tick().then(() => {
      if (!disposed) command({ action: cancel ? 'cancel-resize' : 'end-resize', token: current });
      token = null;
      original = null;
      ending = false;
    });
  }
  const identity = $derived(
    `${snapshot().placement.kind}:${snapshot().displayId}:${snapshot().phase}:${selected()}`,
  );
  $effect(() => {
    void identity;
    untrack(() => {
      generation += 1;
      end(true);
      direction = null;
    });
  });
  $effect(() => {
    const result = startResult();
    if (!result) return;
    untrack(() => {
      if (!awaiting || result.id <= awaiting.after) return;
      const cancelled = awaiting.cancelled || !enabled();
      awaiting = null;
      token = result.token;
      if (!token) {
        restore();
        held = false;
        original = null;
      } else if (cancelled) end(true);
      else if (queuedSize) size = { ...queuedSize };
      queuedSize = null;
    });
  });
  $effect(() => {
    const current = snapshot();
    const activeToken = token;
    if (!enabled() || (activeToken && current.resizeToken !== activeToken))
      untrack(() => end(true));
  });
  onDestroy(() => {
    disposed = true;
    if (token) command({ action: 'cancel-resize', token });
  });
  setDockConversationResize({
    get enabled() {
      return enabled();
    },
    get size() {
      return size;
    },
    get maximum() {
      return maximum();
    },
    get minimum() {
      return minimum();
    },
    get screenRect() {
      const state = snapshot();
      const rect = conversationResizeRect(state, headerHeight());
      return { ...rect, x: rect.x + state.windowBounds.x, y: rect.y + state.windowBounds.y };
    },
    get held() {
      return held;
    },
    get edges(): DockResizeEdge[] {
      return conversationResizeEdges(snapshot(), headerHeight());
    },
    sizeAtPointer(edge, screen) {
      return conversationSizeAtPointer(snapshot(), headerHeight(), edge, screen);
    },
    resize(next) {
      if (ending) return;
      if (awaiting) {
        queuedSize = { ...next };
        return;
      }
      lockDirection();
      size = { width: next.width, height: next.height };
    },
    begin(screen) {
      if (!enabled() || awaiting || token || ending) return false;
      original = { size: { ...size }, direction, generation };
      awaiting = { after: startResult()?.id ?? 0, cancelled: false };
      held = true;
      lockDirection();
      command({
        action: 'begin-resize',
        revision: snapshot().revision,
        origin: {
          x: screen.x - snapshot().windowBounds.x,
          y: screen.y - snapshot().windowBounds.y,
        },
      });
      return true;
    },
    end,
  });
  return {
    get busy() {
      return awaiting !== null || token !== null || ending;
    },
    get size() {
      return size;
    },
    get held() {
      return held;
    },
    get direction() {
      return direction;
    },
    get token() {
      return token;
    },
  };
}
