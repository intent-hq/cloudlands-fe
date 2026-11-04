// `expect` comes from the shared CT module, which re-exports this helper; the cycle is
// safe because `expect` is only read when the helper runs.
import { expectMotionToSettle, type MotionSnapshot } from './ct-settle';
import { expect, type test } from './ct-test';

/**
 * Activate a hover-only action in a Playwright component test without depending on the
 * pointer staying over its row.
 *
 * Why: hover-only actions (message action bars, row toolbars) take pointer events only
 * while their row is hovered (`group-hover:pointer-events-auto`, see
 * `src/lib/components/chat/message-action-surface.ts`). Playwright checks a click's hit
 * target *before* it moves the pointer. When the row moves after `row.hover()` (content
 * above it grows, follow-bottom pins the transcript, a list re-sorts), the pointer is left
 * over another element, the row is no longer hovered, the action stays
 * `pointer-events: none`, and every retry hits the row's text ("… intercepts pointer
 * events") until the test times out. That froze a CT shard for 30 s and ejected the
 * unrelated cloudlands-fe#4078 from the merge queue (run 41601559601; fixed in
 * cloudlands-fe#4112, after a partial fix in #3385). Re-hovering until the action is
 * hittable does not close the window: the row can move again between the check and the
 * click (1 of 3 runs still hung under load in #4112).
 *
 * `activateHoverAction(action, region)` instead:
 * 1. waits until `region` (the element the action moves or resizes: a scroll container,
 *    the row, a list) has stopped moving, and records where it is;
 * 2. waits until `action` is attached and enabled (lazily mounted controls appear
 *    without a hover);
 * 3. presses Enter on `action`. `locator.press` focuses the element, and hover-only
 *    surfaces also open on `group-focus-within`, so this runs the same handler a click
 *    would without any pointer position involved;
 * 4. waits until `region` has changed from step 1 and settled again, so the next step
 *    does not race the motion the action started. Pass `requireChange: false` for an
 *    action that may leave the region where it is (opening a menu or dialog); the helper
 *    then only waits for stillness, and the test asserts the end state itself.
 *
 * Choose a `region` that outlives the action: watch the list, not the row a Remove
 * deletes, since the wait follows only an element that stays attached or is replaced.
 *
 * Returns where `region` settled.
 *
 * Keep a real pointer click only in a test whose point is the pointer path itself, and
 * make that test's row unable to move (no streaming content, follow-bottom settled); the
 * `intent/no-hover-then-click-in-ct` lint rule flags `row.hover()` followed by a click on
 * something inside `row`, and such a test disables it on that line with a reason.
 * Sampling uses `requestAnimationFrame`, so do not call this while `page.clock` is paused.
 */

// ct-svelte bundles its own Playwright, so derive Locator from its fixtures (see menu-geometry.ts).
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

interface ActivateHoverActionOptions {
  /** The key that activates the action (default `'Enter'`; `' '` for Space). */
  key?: string;
  /**
   * Whether activating the action must change `region` (default true). Pass `false` for
   * an action that may leave the region where it is; the helper then only waits for it
   * to be still.
   */
  requireChange?: boolean;
  /** How long `region` must stay still, in ms (default 100, as in `expectMotionToSettle`). */
  quietMs?: number;
  /** Timeout for each wait, in ms (default: the `expect` timeout). */
  timeout?: number;
  message?: string;
}

export async function activateHoverAction(
  action: Locator,
  region: Locator,
  options: ActivateHoverActionOptions = {},
): Promise<MotionSnapshot> {
  const { key = 'Enter', requireChange = true, quietMs, timeout, message } = options;
  const before = await expectMotionToSettle(region, {
    quietMs,
    timeout,
    message: `${String(region)} should settle before activating ${String(action)}`,
  });
  await expect(action, `${String(action)} should be enabled before it is activated`).toBeEnabled({
    timeout,
  });
  await action.press(key, { timeout });
  return expectMotionToSettle(region, {
    quietMs,
    timeout,
    changedFrom: requireChange ? before : undefined,
    message:
      message ??
      (requireChange
        ? `activating ${String(action)} should move or resize ${String(region)}, which should then settle`
        : `${String(region)} should settle after activating ${String(action)}`),
  });
}
