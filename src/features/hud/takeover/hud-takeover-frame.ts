/**
 * Takeover frame FLIP helpers (mock `openOv` `ovFrom` / `ovZoom`): measure
 * the source grid card, and format the inline transform/transition the
 * overlay frame applies while expanding out of the card and collapsing back
 * into it on close. Pure math lives in `hud-takeover-layout`.
 */
import { takeoverFrameFrom, type HudTakeoverFrameFrom } from './hud-takeover-layout';

/** Mock `_zoomT`: the zoom-from frame releases to center 50ms after open. */
export const HUD_TAKEOVER_ZOOM_DELAY_MS = 50;

/** The grid card for a workspace; null when off-grid (filtered/absent). */
export function takeoverSourceCard(workspaceId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  // Attribute matched in JS (not interpolated into the selector) so ids need
  // no CSS escaping (jsdom lacks CSS.escape).
  const cards = document.querySelectorAll<HTMLElement>('[data-testid="hud-ws-card"]');
  for (const card of cards) {
    if (card.getAttribute('data-workspace-id') === workspaceId) return card;
  }
  return null;
}

/** Measure the HUD shell + source card into the frame's zoom-from state. */
export function measureTakeoverFrameFrom(workspaceId: string): HudTakeoverFrameFrom | null {
  if (typeof document === 'undefined') return null;
  const shell = document.querySelector('[data-testid="hud-shell"]');
  const card = takeoverSourceCard(workspaceId);
  if (!shell || !card) return null;
  return takeoverFrameFrom(shell.getBoundingClientRect(), card.getBoundingClientRect());
}

const EXPAND_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/**
 * Inline frame style for the current phase. Empty (CSS-default centered
 * transform) without motion or a measured card; zoom-from transform while
 * pinned to the card; expand/collapse transitions per the mock timings.
 */
export function takeoverFrameStyle(
  from: HudTakeoverFrameFrom | null,
  opts: { closing: boolean; zoom: 'from' | 'to'; motion: boolean },
): { transform?: string; transition?: string } {
  if (!opts.motion || !from) return {};
  const fromTf =
    `translate(-50%, -50%) translate(${from.x.toFixed(1)}px, ${from.y.toFixed(1)}px)` +
    ` scale(${from.sx.toFixed(3)}, ${from.sy.toFixed(3)})`;
  if (opts.closing) {
    return { transform: fromTf, transition: `transform 0.42s ${EXPAND_EASE} 0.22s` };
  }
  if (opts.zoom === 'from') return { transform: fromTf };
  return { transition: `transform 0.5s ${EXPAND_EASE}` };
}
