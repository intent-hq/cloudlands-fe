// `expect` comes from the shared CT module, which re-exports this helper; the cycle is
// safe because `expect` is only read when the helper runs.
import { expect, type test } from './ct-test';

/**
 * Send a mouse wheel to a scroll container in a Playwright component test and resend it
 * until the container actually scrolls.
 *
 * Chromium routes a wheel by the compositor's last committed frame. On a busy machine
 * that frame can predate the element under the pointer (a popover that just opened, a
 * diff that was just laid out), so the wheel is dropped even though the element is
 * scrollable and under the pointer; a second wheel at the same point scrolls at once.
 * A test that sends one `page.mouse.wheel(...)` and then waits for `scrollTop` therefore
 * fails at random: cloudlands-fe#3733 (TaskProgressControl, 4 of 320 runs at 32 workers)
 * and cloudlands-fe#3516 (home-pr-panel, intent-hq/intent#7255). This cannot be fixed in
 * the test's types, so the `intent/no-raw-mouse-wheel-in-ct` lint rule rejects a raw
 * `mouse.wheel` in `*.ct.spec.ts` files and points here.
 *
 * What it does:
 * 1. Waits until `scroller` has room to move in the wheel's direction on at least one
 *    axis the wheel uses (for example `scrollTop > 0` for an upward wheel). A test that
 *    wheels an element that cannot scroll fails here, with the geometry in the message,
 *    instead of resending until the timeout.
 * 2. Moves the pointer (by default hovers `scroller`), takes the starting position (after
 *    that hover, which may itself scroll the pointer target into view), sends the wheel,
 *    and waits up to `attemptTimeout` for `scrollTop` / `scrollLeft` to reach a point
 *    past the start in the wheel's direction. A `scroll` listener records the furthest
 *    point reached, so a wheel that scrolled and was then undone (follow-bottom pulling
 *    the list back, rows growing above it) still counts as landed. Movement the other
 *    way does not count.
 * 3. Repeats step 2 until `timeout`, but never resends once the container has moved:
 *    a wheel that was slow rather than dropped is not doubled. A dropped wheel had no
 *    effect, so resending it is safe. A wheel that lands after `attemptTimeout`, once the
 *    resend was already sent, does scroll twice; raise `attemptTimeout` where a test
 *    checks an exact distance.
 *
 * It resolves as soon as the container starts moving. Tests that need the final
 * position (end of list, back at the bottom, an exact distance) keep their own
 * assertion after the call; `before` is returned for distance checks.
 *
 * Limitation: the page's own movement in the wheel's direction right after the wheel is
 * sent (a smooth scroll still running, a list following new content down) is
 * indistinguishable from the wheel landing. If that wheel was dropped, the test's own
 * end-state assertion still fails, as it did before this helper.
 *
 * For a test that must show that a wheel does NOT scroll, keep the raw
 * `page.mouse.wheel(...)` and disable `intent/no-raw-mouse-wheel-in-ct` on that line
 * with a reason.
 */

// ct-svelte bundles its own Playwright, so derive Locator from its fixtures (see menu-geometry.ts).
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

interface ScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

interface ScrollGeometry extends ScrollPosition {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
}

/** Furthest scroll offsets the container reached since the probe was last reset. */
interface ScrollReach {
  minTop: number;
  maxTop: number;
  minLeft: number;
  maxLeft: number;
}

export interface WheelUntilScrolledOptions {
  /** Horizontal wheel delta in CSS pixels (positive scrolls right). Default 0. */
  deltaX?: number;
  /** Vertical wheel delta in CSS pixels (positive scrolls down). Default 0. */
  deltaY?: number;
  /**
   * Where the wheel is sent from. Default: hover `scroller` (at `position` when given).
   * Pass another locator to hover it instead, for example a child whose wheel chains to
   * `scroller`; page coordinates `{ x, y }` to move the mouse there; or `'current'` to
   * leave the mouse where the test put it.
   */
  pointer?: Locator | { x: number; y: number } | 'current';
  /** Hover position inside a locator `pointer` (or `scroller`), relative to its top left. */
  position?: { x: number; y: number };
  /**
   * Total time for the call, in ms, including the wait for room to scroll. Default 15 000.
   * The first wheel always gets at least `attemptTimeout`.
   */
  timeout?: number;
  /** How long one wheel may take to move the container before it is resent, in ms. Default 2 000. */
  attemptTimeout?: number;
}

export interface WheelUntilScrolledResult {
  /** Scroll position just before the first wheel. */
  before: ScrollPosition;
  /** Scroll position when the helper saw the container had moved in the wheel's direction. */
  after: ScrollPosition;
  /** Wheels sent, including resends of dropped ones. */
  wheels: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 2_000;
/** Longest wait for the container to have room to scroll before the first wheel. */
const ROOM_TIMEOUT_MS = 5_000;
/** Bound on the geometry read that builds the no-room error, so the error is reported. */
const ERROR_READ_TIMEOUT_MS = 1_000;
/** Scroll offsets can be fractional under zoom; smaller changes are not movement. */
const MIN_MOVEMENT_PX = 0.5;
/** Element property holding the page-side scroll probe while the helper runs. */
const PROBE = '__ctWheelUntilScrolledProbe';

function readGeometry(scroller: Locator, timeout?: number): Promise<ScrollGeometry> {
  return scroller.evaluate(
    (node) => ({
      scrollTop: node.scrollTop,
      scrollLeft: node.scrollLeft,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    }),
    undefined,
    timeout === undefined ? {} : { timeout },
  );
}

/** Start (or restart) recording how far the container scrolls; returns where it is now. */
function resetReach(scroller: Locator): Promise<ScrollPosition> {
  return scroller.evaluate((node, key) => {
    type Probe = { reach: ScrollReach; listener: () => void };
    const host = node as unknown as Record<string, Probe | undefined>;
    const { scrollTop, scrollLeft } = node;
    const reach = {
      minTop: scrollTop,
      maxTop: scrollTop,
      minLeft: scrollLeft,
      maxLeft: scrollLeft,
    };
    const existing = host[key];
    if (existing) {
      existing.reach = reach;
    } else {
      const probe: Probe = {
        reach,
        listener: () => {
          const current = host[key]!.reach;
          current.minTop = Math.min(current.minTop, node.scrollTop);
          current.maxTop = Math.max(current.maxTop, node.scrollTop);
          current.minLeft = Math.min(current.minLeft, node.scrollLeft);
          current.maxLeft = Math.max(current.maxLeft, node.scrollLeft);
        },
      };
      host[key] = probe;
      node.addEventListener('scroll', probe.listener, { passive: true });
    }
    return { scrollTop, scrollLeft };
  }, PROBE);
}

/** Current position plus the furthest point reached since the last reset. */
function readReach(scroller: Locator): Promise<{ now: ScrollPosition; reach: ScrollReach }> {
  return scroller.evaluate((node, key) => {
    const host = node as unknown as Record<string, { listener: () => void; reach: ScrollReach }>;
    host[key]?.listener();
    const { scrollTop, scrollLeft } = node;
    const reach = host[key]?.reach ?? {
      minTop: scrollTop,
      maxTop: scrollTop,
      minLeft: scrollLeft,
      maxLeft: scrollLeft,
    };
    return { now: { scrollTop, scrollLeft }, reach: { ...reach } };
  }, PROBE);
}

function removeProbe(scroller: Locator): Promise<void> {
  return scroller.evaluate(
    (node, key) => {
      const host = node as unknown as Record<string, { listener: () => void } | undefined>;
      const probe = host[key];
      if (probe) node.removeEventListener('scroll', probe.listener);
      delete host[key];
    },
    PROBE,
    { timeout: ERROR_READ_TIMEOUT_MS },
  );
}

function hasRoom(geometry: ScrollGeometry, deltaX: number, deltaY: number): boolean {
  const roomDown = geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop;
  const roomRight = geometry.scrollWidth - geometry.clientWidth - geometry.scrollLeft;
  return (
    (deltaY > 0 && roomDown > MIN_MOVEMENT_PX) ||
    (deltaY < 0 && geometry.scrollTop > MIN_MOVEMENT_PX) ||
    (deltaX > 0 && roomRight > MIN_MOVEMENT_PX) ||
    (deltaX < 0 && geometry.scrollLeft > MIN_MOVEMENT_PX)
  );
}

function reachedPast(
  before: ScrollPosition,
  reach: ScrollReach,
  deltaX: number,
  deltaY: number,
): boolean {
  return (
    (deltaY > 0 && reach.maxTop - before.scrollTop > MIN_MOVEMENT_PX) ||
    (deltaY < 0 && before.scrollTop - reach.minTop > MIN_MOVEMENT_PX) ||
    (deltaX > 0 && reach.maxLeft - before.scrollLeft > MIN_MOVEMENT_PX) ||
    (deltaX < 0 && before.scrollLeft - reach.minLeft > MIN_MOVEMENT_PX)
  );
}

function isLocator(pointer: WheelUntilScrolledOptions['pointer']): pointer is Locator {
  return typeof (pointer as Locator | undefined)?.hover === 'function';
}

function describeDirection(deltaX: number, deltaY: number): string {
  const directions = [
    deltaY > 0 ? 'down' : deltaY < 0 ? 'up' : null,
    deltaX > 0 ? 'right' : deltaX < 0 ? 'left' : null,
  ].filter(Boolean);
  return directions.join(' or ');
}

/**
 * Wheel `scroller` and resend the wheel until it scrolls in the wheel's direction.
 * See the module comment for why a single `page.mouse.wheel` is not enough.
 */
export async function wheelUntilScrolled(
  scroller: Locator,
  options: WheelUntilScrolledOptions = {},
): Promise<WheelUntilScrolledResult> {
  const {
    deltaX = 0,
    deltaY = 0,
    pointer = scroller,
    position: hoverPosition,
    timeout = DEFAULT_TIMEOUT_MS,
    attemptTimeout = DEFAULT_ATTEMPT_TIMEOUT_MS,
  } = options;
  if (deltaX === 0 && deltaY === 0) {
    throw new Error('wheelUntilScrolled needs a non-zero deltaX or deltaY');
  }
  const deadline = Date.now() + timeout;
  const page = scroller.page();
  const direction = describeDirection(deltaX, deltaY);
  const wheel = `wheel(${deltaX}, ${deltaY})`;

  try {
    await expect
      .poll(async () => hasRoom(await readGeometry(scroller), deltaX, deltaY), {
        timeout: Math.min(ROOM_TIMEOUT_MS, timeout),
      })
      .toBe(true);
  } catch (error) {
    const geometry = await readGeometry(scroller, ERROR_READ_TIMEOUT_MS).catch(() => null);
    throw new Error(
      `wheelUntilScrolled: the scroll container cannot scroll ${direction} for ${wheel}: ` +
        `${JSON.stringify(geometry)}. A wheel that must not scroll is a raw ` +
        'page.mouse.wheel with intent/no-raw-mouse-wheel-in-ct disabled on that line with a reason',
      { cause: error },
    );
  }

  let before: ScrollPosition | undefined;
  let after: ScrollPosition | undefined;
  let wheels = 0;
  const landed = async () => {
    const { now, reach } = await readReach(scroller);
    after = now;
    return before !== undefined && reachedPast(before, reach, deltaX, deltaY);
  };

  try {
    await expect(async () => {
      // A slow wheel from the previous attempt may have landed meanwhile; do not double it.
      if (wheels > 0 && (await landed())) return;
      if (isLocator(pointer)) {
        await pointer.hover(hoverPosition ? { position: hoverPosition } : {});
      } else if (pointer !== 'current') {
        await page.mouse.move(pointer.x, pointer.y);
      }
      // Start from here, after the hover: movement before the first wheel is not ours.
      if (wheels === 0) before = await resetReach(scroller);
      await page.mouse.wheel(deltaX, deltaY);
      wheels++;
      await expect
        .poll(landed, {
          message:
            `wheelUntilScrolled: ${wheel} scrolls the container ${direction} ` +
            `(attempt ${wheels}; Chromium can drop a wheel routed by a stale compositor ` +
            'frame, cloudlands-fe#3733, intent-hq/intent#7255)',
          timeout: attemptTimeout,
        })
        .toBe(true);
    }).toPass({ timeout: Math.max(deadline - Date.now(), attemptTimeout) });
  } finally {
    await removeProbe(scroller).catch(() => undefined);
  }

  return { before: before!, after: after!, wheels };
}
