/**
 * Renderer-window readiness gate: the single main-process primitive every
 * renderer `BrowserWindow` creation path in `./window.ts` awaits before it
 * constructs a window.
 *
 * The boot flow in `src/main/index.ts` registers the critical IPC handlers
 * (backend, workspace transfer/import) after several slow awaits. A renderer
 * that boots before those handlers exist fails its first invokes with
 * "No handler registered" (intent-hq/intent#5097). Rather than each creation
 * trigger (boot, activate, deep link, second instance, menu, notification
 * click, backend open) re-deriving whether it is safe to open a window, the
 * creators await this gate internally and the boot flow releases it once —
 * right after the critical IPC block — and again from its `finally` so a
 * failed boot never leaves a creator hanging.
 *
 * Kept free of imports from `./index.ts` and `./window.ts` so both can depend
 * on it without a cycle.
 */

let allowed = false;
let release: () => void = () => {};
let allowedPromise = new Promise<void>((resolve) => {
  release = resolve;
});

/** Resolves once renderer windows may be created (already-resolved after release). */
export function whenRendererWindowsAllowed(): Promise<void> {
  return allowedPromise;
}

/** Idempotent: releases every current and future creator awaiting the gate. */
export function markRendererWindowsAllowed(): void {
  if (allowed) return;
  allowed = true;
  release();
}

export function _resetRendererWindowGateForTests(): void {
  allowed = false;
  allowedPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
}
