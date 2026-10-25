import { expect, type test } from './ct-test';

// CT and the top-level Playwright package use different versions; match the fixture.
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

/**
 * Wait until bits-ui listens for outside pointer interaction on `layer`.
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
 * Call this before an outside pointer dismissal. Escape needs no wait:
 * EscapeLayerState registers its keydown listener synchronously.
 */
export async function expectDismissibleLayerArmed(layer: Locator) {
  await expect
    .poll(
      () =>
        layer.evaluate((element) => {
          type Layer = { opts: { ref: { current: Element | null } } };
          const layers = (globalThis as { bitsDismissableLayers?: Map<Layer, unknown> })
            .bitsDismissableLayers;
          if (!layers) {
            throw new Error(
              'globalThis.bitsDismissableLayers is missing; bits-ui changed how it tracks dismissible layers',
            );
          }
          return [...layers.keys()].some((entry) => entry.opts.ref.current === element);
        }),
      { message: 'bits-ui dismissible layer registers its outside-pointer listeners' },
    )
    .toBe(true);
}
