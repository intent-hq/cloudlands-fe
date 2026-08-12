/**
 * Proves the HUD card gate's preload margin is LIVE, in a real browser.
 *
 * The unit suite can only assert how the observer was configured (root ===
 * the scroller, rootMargin === the constant) because jsdom has no layout and
 * no `IntersectionObserver`. This spec runs Chromium's real implementation
 * against the grid's real clipping structure, so the margin is measured.
 *
 * The regression it guards: `IntersectionObserver` intersects the target
 * against every clipping ancestor UNEXPANDED and applies `rootMargin` only to
 * the root's own rectangle. Rooted at the document (as the first cut of this
 * feature was), the scroller's `overflow-y: auto` clip discards a below-the-
 * fold card before the margin is consulted, and the 200px preload silently
 * never happens.
 *
 * Verified by reintroducing that defect: the gate then reported exactly
 * `ws-0,ws-1,ws-2,ws-3` and these tests fail on ws-4.
 */
import { test, expect } from '@playwright/experimental-ct-svelte';

import HudCardVisibilityHarness from './HudCardVisibilityHarness.svelte';

// 300px scroller, 100px cards, so at rest:
//   ws-0..ws-2  on screen                    (0-300px)
//   ws-3        top edge exactly ON the fold (300px) -- NOT a discriminator:
//               Chromium treats that edge-touch as intersecting even under
//               the document root, so it is reported with or without the fix.
//   ws-4        100-200px below the fold     -> inside the 200px preload, and
//               unambiguously outside the scroller's clip. THIS is the proof.
//   ws-5        200-300px below the fold     -> straddles the margin edge, not asserted
//   ws-8        500-600px below the fold     -> far outside the preload
const VIEWPORT_HEIGHT = 300;
const CARD_HEIGHT = 100;

test.describe('HUD card visibility gate — preload margin', () => {
  test('reports a card 100px below the fold (the margin is live)', async ({ mount }) => {
    const component = await mount(HudCardVisibilityHarness, {
      props: { viewportHeight: VIEWPORT_HEIGHT, cardHeight: CARD_HEIGHT, count: 12 },
    });

    // ws-4 sits 100-200px past the scroller's bottom edge. The scroller's
    // `overflow-y: auto` clip excludes it outright; it is only reachable
    // because rootMargin is measured against the scroller rather than the
    // document. Rooted at the document this assertion fails.
    await expect(component.getByTestId('seen')).toContainText('ws-4');
  });

  test('does not report a card far outside the preload margin', async ({ mount }) => {
    const component = await mount(HudCardVisibilityHarness, {
      props: { viewportHeight: VIEWPORT_HEIGHT, cardHeight: CARD_HEIGHT, count: 12 },
    });

    // Settle: once ws-4 is in, the initial delivery has happened.
    await expect(component.getByTestId('seen')).toContainText('ws-4');

    // ws-8 is 500-600px below the fold, well past the 200px margin. A gate
    // that reported everything (no observer, or no gating at all) would list
    // it — this is what stops the margin fix from becoming "load everything".
    const seen = ((await component.getByTestId('seen').textContent()) ?? '')
      .split(',')
      .filter(Boolean);
    expect(seen).not.toContain('ws-8');
    expect(seen).not.toContain('ws-11');
    expect(seen.length).toBeLessThan(12);
  });

  test('reports a far card once it is scrolled into view', async ({ mount, page }) => {
    const component = await mount(HudCardVisibilityHarness, {
      props: { viewportHeight: VIEWPORT_HEIGHT, cardHeight: CARD_HEIGHT, count: 12 },
    });
    await expect(component.getByTestId('seen')).toContainText('ws-4');

    await component.getByTestId('ws-8').scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);

    await expect(component.getByTestId('seen')).toContainText('ws-8');
  });
});
