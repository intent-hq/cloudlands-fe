/**
 * HUD takeover trigger bus — a tiny in-module listener registry connecting
 * the HUD subscription (which sees every daemon event) to the takeover
 * overlay (which owns the queue). Takeover queue state is ephemeral
 * component-local UI, so it stays out of Redux; this bus is the only seam
 * between the two.
 */
import type { HudTakeoverTrigger } from './hud-takeover-queue';

type Listener = (trigger: HudTakeoverTrigger) => void;

const listeners = new Set<Listener>();

/** Register an overlay listener; returns the disposer. */
export function onTakeoverTrigger(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Fan a trigger out to all registered listeners (no-op when none). */
export function emitTakeoverTrigger(trigger: HudTakeoverTrigger): void {
  for (const listener of listeners) listener(trigger);
}
