// Regression for the chat-motion perf harness: the performance mark and the rAF sampling
// must start at the control's actual click dispatch, not when the click is requested.
// A control that is disabled for ~1s makes Playwright's actionability wait observable;
// before the fix the mark, the 400ms trace window, and every sampled frame preceded the
// click, reporting a zero-cost motion while the anchor actually moved.
import { expect, test, type Page } from '@playwright/test';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  analyzeSamples,
  analyzeTrace,
  assertMotionClicks,
} from '../scripts/perf/chat-motion-lib.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs module without type declarations
import {
  FOOTER_HEADER_PREREQUISITE,
  clickControl,
  installPageHelper,
  waitForFooterHeader,
  waitForFrames,
} from '../scripts/perf/chat-motion-page.mjs';

declare global {
  interface Window {
    __chatMotion: {
      pickAnchor(): boolean;
      frame(): { anchorTop?: number };
    };
    __probe: { enabledAtMs: number | null; clickedAtMs: number | null };
  }
}

const FRAMES = 20;
const ENABLE_AFTER_MS = 1000;
const SHIFT_PX = 100;
const BUSY_CLICK_MS = 100;
const FIXTURE = `<!doctype html>
<div data-testid="chat-transcript-scroll-viewport" style="height:300px;overflow:auto;overflow-anchor:none">
  <div id="spacer" style="height:1200px"></div>
  <div data-lazy-turn-key="probe" style="height:120px">anchor</div>
  <div style="height:600px"></div>
</div>
<button id="control" disabled>toggle</button>
<script>
  const control = document.getElementById('control');
  window.__probe = { enabledAtMs: null, clickedAtMs: null };
  control.addEventListener('click', () => {
    window.__probe.clickedAtMs = performance.now();
    document.getElementById('spacer').style.height = '${1200 + SHIFT_PX}px';
  });
  setTimeout(() => {
    control.disabled = false;
    window.__probe.enabledAtMs = performance.now();
  }, ${ENABLE_AFTER_MS});
</script>`;

async function mountFixture(page: Page) {
  await page.setContent(FIXTURE);
  await page.evaluate(() => {
    document.querySelector('[data-testid="chat-transcript-scroll-viewport"]')!.scrollTop = 1100;
  });
  await installPageHelper(page, { frames: FRAMES });
  expect(await page.evaluate(() => window.__chatMotion.pickAnchor())).toBe(true);
}

function readProbe(page: Page) {
  return page.evaluate(() => ({
    ...window.__probe,
    markStartMs: performance.getEntriesByName('probe')[0]?.startTime ?? null,
  }));
}

test('pointer click: mark, trace window and samples align with the delayed dispatch', async ({
  page,
}) => {
  await mountFixture(page);
  const browser = page.context().browser()!;
  await browser.startTracing(page, {
    categories: [
      '-*',
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'blink.user_timing',
    ],
  });
  const baselineAnchorTop = await page.evaluate(() => window.__chatMotion.frame().anchorTop);
  const armedAtMs = await page.evaluate(() => performance.now());
  const motion = await clickControl(page, {
    label: 'probe',
    mark: 'probe',
    selector: '#control',
    pointer: true,
    sample: true,
  });
  const frames = await waitForFrames(page, FRAMES);
  const probe = await readProbe(page);
  const traceEvents = JSON.parse((await browser.stopTracing()).toString('utf8')).traceEvents;

  expect(motion.eventType).toBe('pointerdown');
  expect(probe.enabledAtMs).not.toBeNull();
  expect(probe.enabledAtMs - armedAtMs).toBeGreaterThan(500);
  expect(probe.markStartMs).toBeGreaterThanOrEqual(probe.enabledAtMs);
  expect(probe.clickedAtMs - probe.markStartMs).toBeGreaterThanOrEqual(0);
  expect(probe.clickedAtMs - probe.markStartMs).toBeLessThan(200);

  const motions = analyzeTrace(traceEvents, { marks: ['probe'] });
  expect(() => assertMotionClicks(motions, ['probe'])).not.toThrow();
  expect(motions.probe.clicks[0].offsetMs).toBeGreaterThanOrEqual(0);
  expect(motions.probe.clicks[0].offsetMs).toBeLessThan(400);

  expect(frames).toHaveLength(FRAMES);
  expect(frames[0].anchorTop).toBe(baselineAnchorTop);
  expect(analyzeSamples(frames)).toMatchObject({
    frames: FRAMES,
    anchorDriftPx: SHIFT_PX,
    anchorStayedConnected: true,
  });
});

test('an expensive click handler is attributed to the motion via its enclosing task', async ({
  page,
}) => {
  await mountFixture(page);
  // The mark is emitted inside the click dispatch, so the RunTask running the handler
  // starts before the mark; the task must still count toward the motion. The spin
  // overshoots the asserted threshold because performance.now() is coarsened (100µs)
  // relative to the trace clock.
  await page.evaluate((busyMs) => {
    document.getElementById('control')!.addEventListener('click', () => {
      const until = performance.now() + busyMs + 5;
      while (performance.now() < until) {
        /* spin */
      }
    });
  }, BUSY_CLICK_MS);
  const browser = page.context().browser()!;
  await browser.startTracing(page, {
    categories: [
      '-*',
      'devtools.timeline',
      'disabled-by-default-devtools.timeline',
      'blink.user_timing',
    ],
  });
  await clickControl(page, { label: 'probe', mark: 'probe', selector: '#control', pointer: true });
  const traceEvents = JSON.parse((await browser.stopTracing()).toString('utf8')).traceEvents;

  const motions = analyzeTrace(traceEvents, { marks: ['probe'] });
  expect(() => assertMotionClicks(motions, ['probe'])).not.toThrow();
  expect(motions.probe.clicks[0].durationMs).toBeGreaterThanOrEqual(BUSY_CLICK_MS);
  expect(motions.probe.maxTaskMs).toBeGreaterThanOrEqual(BUSY_CLICK_MS);
  expect(motions.probe.tasksOver16_7.length).toBeGreaterThan(0);
});

test('programmatic click: the capture-phase click listener aligns the mark and samples', async ({
  page,
}) => {
  await mountFixture(page);
  // `node.click()` on a disabled control is a no-op and has no actionability wait; the
  // runner only uses this path on already-enabled controls.
  await page.waitForFunction(() => window.__probe.enabledAtMs !== null);
  const baselineAnchorTop = await page.evaluate(() => window.__chatMotion.frame().anchorTop);
  const motion = await clickControl(page, {
    label: 'probe',
    mark: 'probe',
    selector: '#control',
    pointer: false,
    sample: true,
  });
  const frames = await waitForFrames(page, FRAMES);
  const probe = await readProbe(page);

  expect(motion.eventType).toBe('click');
  expect(probe.clickedAtMs - probe.markStartMs).toBeGreaterThanOrEqual(0);
  expect(probe.clickedAtMs - probe.markStartMs).toBeLessThan(200);
  expect(frames[0].anchorTop).toBe(baselineAnchorTop);
  expect(analyzeSamples(frames)).toMatchObject({ frames: FRAMES, anchorDriftPx: SHIFT_PX });
});

test('a click that lands on a re-rendered control fails naming the motion', async ({ page }) => {
  test.setTimeout(30_000);
  await mountFixture(page);
  // The armed (disabled) control is swapped for an enabled clone while Playwright waits
  // for actionability, so the click dispatches on a node the harness never armed.
  await page.evaluate(() => {
    const control = document.getElementById('control') as HTMLButtonElement;
    setTimeout(() => {
      const clone = control.cloneNode(true) as HTMLButtonElement;
      clone.disabled = false;
      control.replaceWith(clone);
    }, 300);
  });
  await expect(
    clickControl(page, { label: 'probe', mark: 'probe', selector: '#control', pointer: true }),
  ).rejects.toThrow(/^probe: click never dispatched on #control within 5000ms/);
});

// EventSubscriptionsCard renders its body without the disclosure header when every
// subscription is an agent; the footer scenario must name that prerequisite promptly
// instead of waiting the full --timeout for a header that never mounts.
test('footer scenario: a body without a disclosure header fails naming the prerequisite', async ({
  page,
}) => {
  await page.setContent('<div data-testid="event-subscriptions-body">agent-only</div>');
  const startedAt = Date.now();
  await expect(waitForFooterHeader(page, { timeout: 60_000, headerGraceMs: 500 })).rejects.toThrow(
    FOOTER_HEADER_PREREQUISITE,
  );
  expect(Date.now() - startedAt).toBeLessThan(10_000);
});

test('footer scenario: a disclosure header that mounts after the body is accepted', async ({
  page,
}) => {
  await page.setContent('<div data-testid="event-subscriptions-body">subscriptions</div>');
  await page.evaluate(() => {
    setTimeout(() => {
      const header = document.createElement('button');
      header.setAttribute('aria-controls', 'event-subscriptions-body-1');
      header.setAttribute('aria-expanded', 'true');
      document.body.prepend(header);
    }, 300);
  });
  await expect(
    waitForFooterHeader(page, { timeout: 5_000, headerGraceMs: 2_000 }),
  ).resolves.toBeUndefined();
});
