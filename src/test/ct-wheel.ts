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
 * 2. Moves the pointer (by default hovers `scroller`), sends the wheel, and waits up to
 *    `attemptTimeout` for `scrollTop` / `scrollLeft` to move in the wheel's direction
 *    from where it was before the first wheel. Movement the other way, such as
 *    follow-bottom pulling the list back down, does not count.
 * 3. Repeats step 2 until `timeout`, but never resends once the container has moved:
 *    a wheel that was slow rather than dropped is not doubled. A dropped wheel had no
 *    effect, so resending it is safe.
 *
 * It resolves as soon as the container starts moving. Tests that need the final
 * position (end of list, back at the bottom, an exact distance) keep their own
 * assertion after the call; `before` is returned for distance checks.
 *
 * For a test that must show that a wheel does NOT scroll, keep the raw
 * `page.mouse.wheel(...)` and disable `intent/no-raw-mouse-wheel-in-ct` on that line
 * with a reason.
 */

// ct-svelte bundles its own Playwright, so derive Locator from its fixtures (see menu-geometry.ts).
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

export interface ScrollPosition {
  scrollTop: number;
  scrollLeft: number;
}

interface ScrollGeometry extends ScrollPosition {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
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
  /** Total time for every attempt, in ms. Default 15 000. */
  timeout?: number;
  /** How long one wheel may take to move the container before it is resent, in ms. Default 2 000. */
  attemptTimeout?: number;
}

export interface WheelUntilScrolledResult {
  /** Scroll position before the first wheel. */
  before: ScrollPosition;
  /** Scroll position once it had moved in the wheel's direction. */
  after: ScrollPosition;
  /** Wheels sent, including resends of dropped ones. */
  wheels: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 2_000;
/** Longest wait for the container to have room to scroll before the first wheel. */
const ROOM_TIMEOUT_MS = 5_000;
/** Scroll offsets can be fractional under zoom; smaller changes are not movement. */
const MIN_MOVEMENT_PX = 0.5;

function readGeometry(scroller: Locator): Promise<ScrollGeometry> {
  return scroller.evaluate((node) => ({
    scrollTop: node.scrollTop,
    scrollLeft: node.scrollLeft,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth,
  }));
}

function position({ scrollTop, scrollLeft }: ScrollPosition): ScrollPosition {
  return { scrollTop, scrollLeft };
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

function movedToward(
  before: ScrollPosition,
  now: ScrollPosition,
  deltaX: number,
  deltaY: number,
): boolean {
  const down = now.scrollTop - before.scrollTop;
  const right = now.scrollLeft - before.scrollLeft;
  return (
    (deltaY > 0 && down > MIN_MOVEMENT_PX) ||
    (deltaY < 0 && down < -MIN_MOVEMENT_PX) ||
    (deltaX > 0 && right > MIN_MOVEMENT_PX) ||
    (deltaX < 0 && right < -MIN_MOVEMENT_PX)
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
  const page = scroller.page();
  const direction = describeDirection(deltaX, deltaY);
  const wheel = `wheel(${deltaX}, ${deltaY})`;

  await expect
    .poll(
      async () => {
        const geometry = await readGeometry(scroller);
        return { canScroll: hasRoom(geometry, deltaX, deltaY), ...geometry };
      },
      {
        message:
          `wheelUntilScrolled: the scroll container can scroll ${direction} before ${wheel} ` +
          'is sent. A wheel that must not scroll is a raw page.mouse.wheel with ' +
          'intent/no-raw-mouse-wheel-in-ct disabled on that line',
        timeout: Math.min(ROOM_TIMEOUT_MS, timeout),
      },
    )
    .toMatchObject({ canScroll: true });

  const before = position(await readGeometry(scroller));
  let after = before;
  let wheels = 0;
  const read = async () => {
    after = position(await readGeometry(scroller));
    return movedToward(before, after, deltaX, deltaY);
  };

  await expect(async () => {
    // A slow wheel from the previous attempt may have landed meanwhile; do not double it.
    if (await read()) return;
    if (isLocator(pointer)) {
      await pointer.hover(hoverPosition ? { position: hoverPosition } : {});
    } else if (pointer !== 'current') {
      await page.mouse.move(pointer.x, pointer.y);
    }
    await page.mouse.wheel(deltaX, deltaY);
    wheels++;
    await expect
      .poll(read, {
        message:
          `wheelUntilScrolled: ${wheel} scrolls the container ${direction} ` +
          `(attempt ${wheels}; Chromium can drop a wheel routed by a stale compositor ` +
          'frame, cloudlands-fe#3733, intent-hq/intent#7255)',
        timeout: attemptTimeout,
      })
      .toBe(true);
  }).toPass({ timeout });

  return { before, after, wheels };
}
