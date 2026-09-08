/**
 * Banner-typewriter sound cue (runes) — fires the `banner-typewriter`
 * garnish when the FIRST banner's wipe-in begins (the CSS
 * `--banner-in-delay`: 1.0s, or 3.5s when the map pans to a far changed
 * cell first). No queue transition aligns with the wipe start, so this
 * mirrors the delay with a timer armed at 'opening' (kept through
 * 'dwelling', where a panning display's wipe lands; a `needsPan` flip
 * re-arms the pending timer against the same opening start). At most once
 * per display; cancelled on an early leave (dismiss → 'closing') or viewer
 * conversion. Reduced motion renders banners with no wipe → no cue (a flip
 * to reduced motion while a timer is pending cancels it, and motion is
 * re-checked at fire time). Must be created during component init ($effect
 * attaches to the component).
 */
import { bannerDelay } from '../takeover/hud-takeover-layout';
import type { HudTakeoverQueueState } from '../takeover/hud-takeover-queue';
import { playHudSoundCue } from './hud-sound-player';

export interface HudTypewriterCue {
  destroy(): void;
}

export function createTypewriterCue(deps: {
  queue: () => HudTakeoverQueueState;
  motion: () => boolean;
  needsPan: () => boolean;
}): HudTypewriterCue {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let key = '';
  let openedAtMs = 0;
  let fired = false;

  $effect(() => {
    const queue = deps.queue();
    const armedPhase = queue.phase === 'opening' || queue.phase === 'dwelling';
    if (!armedPhase || !queue.active || queue.active.isViewer) {
      key = '';
      clearTimeout(timer);
      return;
    }
    if (!deps.motion()) {
      // Reduced motion renders no wipe — cancel any timer armed before the
      // preference flipped ($state-backed, so the flip re-runs this effect).
      clearTimeout(timer);
      return;
    }
    if (queue.active.workspaceId !== key) {
      // A fresh display arms only at its opening start.
      if (queue.phase !== 'opening') return;
      key = queue.active.workspaceId;
      openedAtMs = Date.now();
      fired = false;
    } else if (fired) {
      return;
    }
    const delayMs = Number(bannerDelay(deps.needsPan(), 0)) * 1000;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        fired = true;
        if (!deps.motion()) return;
        void playHudSoundCue('banner-typewriter');
      },
      Math.max(0, openedAtMs + delayMs - Date.now()),
    );
  });

  return {
    destroy() {
      clearTimeout(timer);
    },
  };
}
