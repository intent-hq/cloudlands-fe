// Page-side helper and click alignment shared by the chat-motion trace runner and its
// Playwright regression (test/chat-motion-click-alignment.spec.ts). The performance mark
// and the rAF sampling start on the control's own pointerdown/click dispatch, so a click
// delayed by Playwright's actionability or scroll-into-view waits stays inside the
// analysis window instead of landing after it.

export const VIEWPORT_SELECTOR = '[data-testid="chat-transcript-scroll-viewport"]';
const CLICK_DISPATCH_TIMEOUT_MS = 5000;
const CLICK_TIMEOUT_MS = 5000;

export function installPageHelper(page, { frames, viewportSelector = VIEWPORT_SELECTOR }) {
  return page.evaluate(
    ({ viewportSelector, frames }) => {
      const viewport = document.querySelector(viewportSelector);
      const helper = {
        anchor: null,
        frames: [],
        motion: null,
        pickAnchor() {
          const bounds = viewport.getBoundingClientRect();
          helper.anchor =
            [...viewport.querySelectorAll('[data-lazy-turn-key]')]
              .filter((node) => !node.closest('[data-inflated]'))
              .find((node) => {
                const rect = node.getBoundingClientRect();
                return rect.bottom > bounds.top + 40 && rect.top < bounds.bottom;
              }) ?? null;
          return helper.anchor !== null;
        },
        geometry() {
          return { top: viewport.scrollTop, max: viewport.scrollHeight - viewport.clientHeight };
        },
        quietKey() {
          return `${viewport.scrollTop},${viewport.scrollHeight}`;
        },
        frame() {
          const anchor = helper.anchor;
          return {
            ...helper.geometry(),
            anchorTop: anchor ? anchor.getBoundingClientRect().top : undefined,
            anchorConnected: anchor ? anchor.isConnected : undefined,
          };
        },
        sample(count) {
          let remaining = count;
          const tick = () => {
            helper.frames.push(helper.frame());
            if (--remaining > 0) requestAnimationFrame(tick);
          };
          if (remaining > 0) requestAnimationFrame(tick);
        },
        startSampling() {
          helper.frames = [];
          helper.sample(frames);
        },
        // One-shot capture-phase listener on the resolved control: the first pointerdown
        // (pointer click) or click (programmatic `node.click()`) emits the mark and, when
        // sampling, starts the rAF frames after the pre-motion baseline frame.
        armMotion({ mark, selector, sample }) {
          const node = document.querySelector(selector);
          if (!node) throw new Error(`${mark}: control ${selector} not found`);
          const motion = { mark, dispatchedAtMs: null, eventType: null };
          const fire = (event) => {
            if (motion.dispatchedAtMs !== null) return;
            motion.dispatchedAtMs = performance.now();
            motion.eventType = event.type;
            performance.mark(mark);
            if (sample) helper.sample(frames - 1);
            node.removeEventListener('pointerdown', fire, true);
            node.removeEventListener('click', fire, true);
          };
          node.addEventListener('pointerdown', fire, true);
          node.addEventListener('click', fire, true);
          helper.frames = sample ? [helper.frame()] : [];
          helper.motion = motion;
        },
      };
      window.__chatMotion = helper;
    },
    { viewportSelector, frames },
  );
}

// Arms the motion, issues the click, and waits (bounded) for the armed listener to see
// the dispatch. A click that lands elsewhere (for example on a re-rendered control) is a
// runtime failure naming the motion, not a zero-cost result.
export async function clickControl(page, { label, mark, selector, pointer, sample = false }) {
  await page.evaluate((motion) => window.__chatMotion.armMotion(motion), {
    mark,
    selector,
    sample,
  });
  const control = page.locator(selector);
  if (pointer) await control.click({ timeout: CLICK_TIMEOUT_MS });
  else await control.evaluate((node) => node.click());
  try {
    await page.waitForFunction(
      () => window.__chatMotion.motion.dispatchedAtMs !== null,
      undefined,
      {
        timeout: CLICK_DISPATCH_TIMEOUT_MS,
      },
    );
  } catch (error) {
    throw new Error(
      `${label}: click never dispatched on ${selector} within ${CLICK_DISPATCH_TIMEOUT_MS}ms: ${error.message}`,
    );
  }
  return page.evaluate(() => window.__chatMotion.motion);
}

export async function waitForFrames(page, frames) {
  await page.waitForFunction((count) => window.__chatMotion.frames.length >= count, frames, {
    timeout: frames * 250 + 2000,
  });
  return page.evaluate(() => window.__chatMotion.frames);
}
