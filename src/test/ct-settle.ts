// `expect` comes from the shared CT module, which re-exports these helpers; the cycle is
// safe because `expect` is only read when a helper runs.
import { expect, type test } from './ct-test';

/**
 * Wait for motion to settle before the next click or measurement in a Playwright
 * component test, instead of a fixed `page.waitForTimeout(...)`.
 *
 * Why: Playwright hit-tests only the `pointerdown` of a click. When the target moves
 * between `mousedown` and `mouseup` (a disclosure above it is still animating its
 * height, a list is still smooth-scrolling) the browser sends `click` to the common
 * ancestor and the click is silently lost. cloudlands-fe#3955 fixed one such spec
 * (merge-group run 41203676601 shows the dropped toggle); the bug ejected the unrelated
 * cloudlands-fe#3920 from the merge queue. A fixed sleep only hides the race until a
 * runner is slow enough, and a one-shot "is anything animating?" check passes before
 * motion has begun. These helpers poll in the page instead.
 *
 * - `clickAndSettle(control, region)` clicks `control`, waits until `region` (the
 *   element the click animates: a disclosure wrapper, a scroll container, a tab slot)
 *   has changed, then waits until it stops moving. Use it for every click whose motion
 *   moves the next thing the test clicks or measures.
 * - `expectMotionToSettle(region, { changedFrom })` is the same wait without the click,
 *   for motion started some other way (`component.update`, a keyboard press, a resize).
 *   Pass `changedFrom: await motionSnapshot(region)` taken before the trigger, so a check
 *   that runs before the motion has begun cannot pass early.
 *
 * "Settled" means: the region's box (`getBoundingClientRect`, so transforms count), its
 * scroll offsets and scrollable content size, and its finite CSS / Web Animations (on it
 * and its subtree) have all been still for `quietMs` and at least three animation frames.
 * The region must stay attached; if the locator's element is replaced, the wait follows
 * the new one.
 * Infinite animations (spinners, shimmer) are ignored. Motion driven from JavaScript
 * (springs writing `style.height` each frame, `animatedHeight`) is seen through the box.
 *
 * Not for "nothing else happens" checks: settling proves motion stopped, not that a
 * deferred effect (a timer, a later request) will never run. Keep those waits explicit.
 * Sampling uses `requestAnimationFrame`, so do not call these while `page.clock` is
 * paused.
 *
 * The `intent/no-wait-for-timeout-in-ct` lint rule caps `waitForTimeout` per
 * `*.ct.spec.ts` file at today's count and points here.
 */

// ct-svelte bundles its own Playwright, so derive Locator from its fixtures (see menu-geometry.ts).
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;
type ClickOptions = NonNullable<Parameters<Locator['click']>[0]>;

/** The region's position, size, scroll offsets and scrollable content size, in CSS pixels. */
export interface MotionSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollTop: number;
  scrollLeft: number;
  scrollWidth: number;
  scrollHeight: number;
}

interface SettleOptions {
  /**
   * Require the region to differ from this snapshot before it may count as settled, so
   * motion that has not started yet is waited for rather than mistaken for stillness.
   */
  changedFrom?: MotionSnapshot;
  /** How long the region must stay still, in ms (default 100). */
  quietMs?: number;
  /** Overall timeout in ms (default: the `expect` timeout). */
  timeout?: number;
  message?: string;
}

interface ClickAndSettleOptions extends Omit<SettleOptions, 'changedFrom'> {
  /** Options passed to `control.click()`. */
  click?: ClickOptions;
  /**
   * Whether the click must change the region (default true). Pass `false` for a click
   * that may leave the region where it is (it then only waits for stillness).
   */
  requireChange?: boolean;
}

const DEFAULT_QUIET_MS = 100;
/** Minimum consecutive still frames, whatever `quietMs` is. */
const MIN_STILL_FRAMES = 3;
/** One in-page sampling attempt; the outer poll retries until the timeout. */
const ATTEMPT_MS = 1_000;
/** Finite animations no longer than this (ms, including delay) are instant, not motion. */
const INSTANT_ANIMATION_MS = 1;

type Attempt =
  | { state: 'settled'; snapshot: MotionSnapshot }
  | { state: 'unchanged'; snapshot: MotionSnapshot }
  | { state: 'moving'; snapshot: MotionSnapshot; animations: string[] }
  /** The element was replaced; `changed` says whether a change was seen before that. */
  | { state: 'detached'; changed: boolean };

/** The region's current position, size and scroll offsets. */
export async function motionSnapshot(region: Locator): Promise<MotionSnapshot> {
  return region.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    };
  });
}

function sampleUntilStill(
  region: Locator,
  args: { changedFrom: MotionSnapshot | null; quietMs: number },
): Promise<Attempt> {
  return region.evaluate(
    (element, { changedFrom, quietMs, minFrames, attemptMs, instantMs }) =>
      new Promise<Attempt>((resolve) => {
        const read = (): MotionSnapshot => {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            scrollTop: element.scrollTop,
            scrollLeft: element.scrollLeft,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          };
        };
        const same = (a: MotionSnapshot, b: MotionSnapshot) =>
          a.x === b.x &&
          a.y === b.y &&
          a.width === b.width &&
          a.height === b.height &&
          a.scrollTop === b.scrollTop &&
          a.scrollLeft === b.scrollLeft &&
          a.scrollWidth === b.scrollWidth &&
          a.scrollHeight === b.scrollHeight;
        // getAnimations() flushes style, so a transition whose state change is still
        // pending (or in its delay phase) is already listed here.
        const running = () =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => {
              if (animation.playState !== 'running' && !animation.pending) return false;
              const end = Number(animation.effect?.getComputedTiming().endTime ?? Infinity);
              return Number.isFinite(end) && end > instantMs;
            })
            .map((animation) => {
              const target =
                animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
              const name =
                typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition
                  ? animation.transitionProperty
                  : typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation
                    ? animation.animationName
                    : animation.id || 'animation';
              return `${target?.tagName.toLowerCase() ?? '?'} ${name}`;
            });

        const startedAt = performance.now();
        let changed = changedFrom === null || !same(read(), changedFrom);
        let last = read();
        let stillSince = startedAt;
        let stillFrames = 0;
        const tick = () => {
          const now = performance.now();
          // A replaced element reads as a zero box that never moves; end the attempt so
          // the next one re-resolves the locator.
          if (!element.isConnected) {
            resolve({ state: 'detached', changed });
            return;
          }
          const current = read();
          const animations = running();
          if (!changed && !same(current, changedFrom!)) changed = true;
          if (!same(current, last) || animations.length > 0) {
            stillSince = now;
            stillFrames = 0;
          } else {
            stillFrames += 1;
          }
          last = current;
          if (changed && stillFrames >= minFrames && now - stillSince >= quietMs) {
            resolve({ state: 'settled', snapshot: current });
            return;
          }
          if (now - startedAt >= Math.max(attemptMs, quietMs * 2)) {
            resolve(
              changed
                ? { state: 'moving', snapshot: current, animations }
                : { state: 'unchanged', snapshot: current },
            );
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    {
      ...args,
      minFrames: MIN_STILL_FRAMES,
      attemptMs: ATTEMPT_MS,
      instantMs: INSTANT_ANIMATION_MS,
    },
  );
}

function describeAttempt(attempt: Attempt, changedFrom: MotionSnapshot | null): string {
  if (attempt.state === 'settled') return 'settled';
  if (attempt.state === 'detached') return 'was replaced by a new element';
  if (attempt.state === 'unchanged') {
    return `has not changed from ${JSON.stringify(changedFrom)} yet`;
  }
  const animations = attempt.animations.length
    ? `; running animations: ${attempt.animations.join(', ')}`
    : '';
  return `still moving at ${JSON.stringify(attempt.snapshot)}${animations}`;
}

/**
 * Wait until `region` has stopped moving (see the module comment for what counts) and
 * return where it settled. With `changedFrom`, the region must first differ from that
 * snapshot. Throws when the locator matches no element.
 */
export async function expectMotionToSettle(
  region: Locator,
  options: SettleOptions = {},
): Promise<MotionSnapshot> {
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  let changedFrom = options.changedFrom ?? null;
  let settled: MotionSnapshot | undefined;
  await expect
    .poll(
      async () => {
        const attempt = await sampleUntilStill(region, { changedFrom, quietMs });
        // Once a change has been seen, later attempts only wait for stillness: the region
        // may legitimately come to rest where it started (an expand-then-collapse). A
        // replacement alone is not a change: a same-size element may only start moving
        // later.
        const changed =
          attempt.state === 'detached' ? attempt.changed : attempt.state !== 'unchanged';
        if (changed) changedFrom = null;
        if (attempt.state === 'settled') settled = attempt.snapshot;
        return describeAttempt(attempt, changedFrom);
      },
      {
        message: options.message ?? `motion of ${String(region)} should settle`,
        timeout: options.timeout,
        // Each attempt already samples for up to a second in the page.
        intervals: [0],
      },
    )
    .toBe('settled');
  return settled!;
}

/**
 * Click `control`, then wait until `region` has changed and stopped moving, so the next
 * click or measurement does not race the motion the click started. `control` is first
 * waited on to be still, so a click never lands on a target that is still moving from
 * an earlier step. Returns where `region` settled.
 */
export async function clickAndSettle(
  control: Locator,
  region: Locator,
  options: ClickAndSettleOptions = {},
): Promise<MotionSnapshot> {
  const { click, requireChange = true, ...settle } = options;
  await expectMotionToSettle(control, {
    quietMs: settle.quietMs,
    timeout: settle.timeout,
    message: `${String(control)} should stop moving before it is clicked`,
  });
  const before = requireChange ? await motionSnapshot(region) : undefined;
  await control.click(click);
  return expectMotionToSettle(region, {
    ...settle,
    changedFrom: before,
    message:
      settle.message ??
      (requireChange
        ? `clicking ${String(control)} should move or resize ${String(region)}, which should then settle`
        : `${String(region)} should settle after clicking ${String(control)}`),
  });
}
