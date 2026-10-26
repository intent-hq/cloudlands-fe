/**
 * `CT_DELAY_DISMISSIBLE_LAYER=1`: make bits-ui's outside-click race happen on
 * every run, so a test can prove that its `expectDismissibleLayerArmed` wait
 * (src/test/dismissible-layer.ts) is what keeps it passing.
 *
 * bits-ui arms a menu, popover, select, combobox or dialog for outside
 * pointers in `afterSleep(1, …)`, which is `setTimeout(cb, 1)`. Normally an
 * early click loses that race only on a busy machine. With the switch on,
 * src/test/ct-test.ts adds {@link delayOneMillisecondTimers} as an init script
 * before the CT page loads, so every `setTimeout(…, 1)` waits
 * {@link CT_DISMISSIBLE_LAYER_DELAY_MS} instead: a guarded test still passes,
 * and the same test without its wait fails at its closed-state check. Nothing
 * is rebuilt, because the patch runs in the page, not in the CT bundle.
 *
 * The patch slows every 1 ms timer on the page, not only bits-ui's, so use it
 * for proof runs only. CI never sets it.
 *
 * Kept free of `process` access so vitest covers the resolution directly.
 */
export const CT_DISMISSIBLE_LAYER_DELAY_MS = 500;

export interface ResolveCtDismissibleLayerDelayOptions {
  env: Record<string, string | undefined>;
}

/**
 * Unset, blank or `0` → `undefined` (off). `1` → the delay in ms. Any other
 * value throws, so a typo cannot silently run an unproven "proof".
 */
export function resolveCtDismissibleLayerDelay({
  env,
}: ResolveCtDismissibleLayerDelayOptions): number | undefined {
  const raw = env.CT_DELAY_DISMISSIBLE_LAYER?.trim() ?? '';
  if (raw === '' || raw === '0') return undefined;
  if (raw === '1') return CT_DISMISSIBLE_LAYER_DELAY_MS;
  throw new Error(
    `CT_DELAY_DISMISSIBLE_LAYER=${JSON.stringify(env.CT_DELAY_DISMISSIBLE_LAYER)} is not ` +
      `supported: use 1 to delay bits-ui's 1 ms layer setup timer to ` +
      `${CT_DISMISSIBLE_LAYER_DELAY_MS} ms, or leave it unset (playwright/ct-dismissible-layer-delay.ts)`,
  );
}

/** Name of the page global the init script sets; the fixture checks it after navigation. */
export const CT_DISMISSIBLE_LAYER_DELAY_MARKER = '__ctDismissibleLayerDelayMs';

/**
 * Init script: wrap `setTimeout` so a delay of exactly 1 ms becomes `delayMs`.
 * Playwright serializes it into the page with `toString()`, so it must not
 * reference anything outside its own body. Running it twice is a no-op.
 */
export function delayOneMillisecondTimers(delayMs: number): void {
  const scope = globalThis as typeof globalThis & { __ctDismissibleLayerDelayMs?: number };
  if (scope.__ctDismissibleLayerDelayMs !== undefined) return;
  const original = scope.setTimeout;
  const delayed = (handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
    original(handler, timeout === 1 ? delayMs : timeout, ...args);
  scope.setTimeout = delayed as typeof setTimeout;
  scope.__ctDismissibleLayerDelayMs = delayMs;
}
