/**
 * HUD takeover trigger bus — a tiny in-module listener registry connecting
 * the HUD subscription (which sees every daemon event) to the takeover
 * overlay (which owns the queue). Takeover queue state is ephemeral
 * component-local UI, so it stays out of Redux; this bus is the only seam
 * between the two. It also carries the blink-target readable the grid cards
 * watch to play the pre-roll flash (mock `ovPend` → `wsflash`).
 */
import { writable, type Readable } from 'svelte/store';
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

const blinkTarget = writable<string | null>(null);

/** Workspace whose grid card should flash during the pre-roll; null when none. */
export const takeoverBlinkTarget: Readable<string | null> = { subscribe: blinkTarget.subscribe };

/** Overlay-only setter: publish/clear the blinking workspace. */
export function setTakeoverBlinkTarget(workspaceId: string | null): void {
  blinkTarget.set(workspaceId);
}
