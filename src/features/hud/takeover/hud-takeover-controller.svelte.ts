/**
 * Takeover controller (runes) — owns the queue state machine wiring for the
 * overlay: phase timers, the pre-roll card blink (publishes the blink target
 * so the grid card flashes, mock `ovPend` → `wsflash`; a missing card skips
 * straight to the open), and the FLIP zoom state (measure the source card on
 * open, pin the frame to it, release to center 50ms later — mock
 * `ovFrom`/`ovZoom`). Reduced motion (`reduced()`) disables blink + zoom.
 * Must be created during component init ($effect attaches to the component).
 */
import { setTakeoverBlinkTarget } from './hud-takeover-bus';
import {
  createHudTakeoverQueue,
  dismissTakeover,
  enqueueTakeover,
  nextTakeoverDeadline,
  requestImmediateTakeover,
  skipTakeoverBlink,
  tickTakeoverQueue,
  type HudTakeoverQueueState,
  type HudTakeoverTrigger,
} from './hud-takeover-queue';
import {
  HUD_TAKEOVER_ZOOM_DELAY_MS,
  measureTakeoverFrameFrom,
  takeoverSourceCard,
} from './hud-takeover-frame';
import type { HudTakeoverFrameFrom } from './hud-takeover-layout';

export interface HudTakeoverController {
  readonly queue: HudTakeoverQueueState;
  readonly frameFrom: HudTakeoverFrameFrom | null;
  readonly zoom: 'from' | 'to';
  enqueue(trigger: HudTakeoverTrigger): void;
  openViewer(trigger: HudTakeoverTrigger): void;
  dismiss(): void;
  destroy(): void;
}

export function createTakeoverController(reduced: () => boolean): HudTakeoverController {
  let queue = $state<HudTakeoverQueueState>(createHudTakeoverQueue());
  let frameFrom = $state<HudTakeoverFrameFrom | null>(null);
  let zoom = $state<'from' | 'to'>('to');
  let phaseTimer: ReturnType<typeof setTimeout> | undefined;
  let zoomTimer: ReturnType<typeof setTimeout> | undefined;
  let zoomKey = '';

  const options = () => ({ blink: !reduced() });

  function apply(next: HudTakeoverQueueState) {
    queue = next;
    clearTimeout(phaseTimer);
    const deadline = nextTakeoverDeadline(next);
    if (deadline !== null) {
      phaseTimer = setTimeout(() => {
        apply(tickTakeoverQueue(queue, Date.now(), options()));
      }, Math.max(0, deadline - Date.now()));
    }
  }

  // Pre-roll blink: publish the card target; missing card → instant open.
  // The card scrolls into view first (mock `triggerOv` scrolls the grid
  // before the pre-flash; smooth unless reduced motion).
  $effect(() => {
    if (queue.phase === 'blinking' && queue.active) {
      const workspaceId = queue.active.workspaceId;
      const card = takeoverSourceCard(workspaceId);
      if (!card) {
        apply(skipTakeoverBlink(queue, Date.now()));
        return;
      }
      card.scrollIntoView?.({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
      setTakeoverBlinkTarget(workspaceId);
      return () => setTakeoverBlinkTarget(null);
    }
    setTakeoverBlinkTarget(null);
  });

  // FLIP zoom: measured once per display (`zoomKey` dedupes coalesce re-runs).
  $effect(() => {
    if (queue.phase !== 'opening' || !queue.active) {
      zoomKey = '';
      if (queue.phase === 'idle') frameFrom = null;
      return;
    }
    const workspaceId = queue.active.workspaceId;
    if (workspaceId === zoomKey) return;
    zoomKey = workspaceId;
    frameFrom = reduced() ? null : measureTakeoverFrameFrom(workspaceId);
    zoom = 'from';
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      zoom = 'to';
    }, HUD_TAKEOVER_ZOOM_DELAY_MS);
  });

  return {
    get queue() {
      return queue;
    },
    get frameFrom() {
      return frameFrom;
    },
    get zoom() {
      return zoom;
    },
    enqueue(trigger) {
      apply(
        enqueueTakeover(tickTakeoverQueue(queue, Date.now(), options()), trigger, Date.now(), options()),
      );
    },
    openViewer(trigger) {
      apply(
        requestImmediateTakeover(
          tickTakeoverQueue(queue, Date.now(), options()),
          trigger,
          Date.now(),
          options(),
        ),
      );
    },
    dismiss() {
      apply(dismissTakeover(queue, Date.now()));
    },
    destroy() {
      clearTimeout(phaseTimer);
      clearTimeout(zoomTimer);
      setTakeoverBlinkTarget(null);
    },
  };
}
