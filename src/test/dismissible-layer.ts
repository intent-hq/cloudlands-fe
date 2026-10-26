import { expect, type test } from './ct-test';
import { DISMISSIBLE_LAYER_ARMED, readDismissibleLayerState } from './dismissible-layer-state';

// CT and the top-level Playwright package use different versions; match the fixture.
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

/**
 * Wait until bits-ui listens for outside pointer interaction on the layer
 * that contains `target`.
 *
 * bits-ui's DismissibleLayerState registers its document `pointerdown`
 * listeners in `afterSleep(1, …)`, a timer that runs after the content is
 * mounted, so that the event that opened the layer is not treated as an
 * outside click. Chromium runs queued input ahead of timers. When the page is
 * busy, a `page.mouse.click()` sent as soon as `toBeVisible()` resolves can
 * reach the page before that timer fires. bits-ui never sees the click, and
 * the layer stays open. The timer adds the layer to
 * `globalThis.bitsDismissableLayers` in the same step as it adds the
 * listeners, so membership in that map shows the layer is ready for an
 * outside click.
 *
 * `target` may be the layer element itself or any element inside it, such as
 * `page.getByRole('listbox')` inside select content or a menu item. The wait
 * covers the innermost bits-ui layer around it (see
 * `readDismissibleLayerState`). For an open nested layer, point at an element
 * inside the inner layer. A target that no bits-ui layer contains, such as
 * the custom `ui/dropdown` popup, fails with a message that says so. The
 * locator must match exactly one element.
 *
 * Call this before an outside pointer dismissal. Escape needs no wait:
 * EscapeLayerState registers its keydown listener synchronously.
 *
 * To prove a wait matters, run the spec with `CT_DELAY_DISMISSIBLE_LAYER=1`
 * (see `src/test/ct-test.ts`): the 1 ms setup timer becomes 500 ms, so the
 * test passes with the wait and fails without it.
 */
export async function expectDismissibleLayerArmed(
  target: Locator,
  options: { timeout?: number } = {},
) {
  await expect
    .poll(() => target.evaluate(readDismissibleLayerState), {
      message: 'bits-ui dismissible layer registers its outside-pointer listeners',
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    })
    .toBe(DISMISSIBLE_LAYER_ARMED);
}
