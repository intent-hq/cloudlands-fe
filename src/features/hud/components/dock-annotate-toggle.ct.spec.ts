import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';

/**
 * The annotate button toggles on every click, in every pointer and timing
 * sequence: production composer, controller, sagas and tool popover; only the
 * native helper is synthetic (it answers like main: a replaced or ended session
 * is refused, and native may end a session on its own).
 *
 * Each click must flip the visible state at once (aria-pressed, citrus) and the
 * synthetic native must settle in the matching state.
 */
type Native = {
  sessionId: string | null;
  log: { annotations: { id: string; mode: string; tool: string }[] };
  holdStarts: (value: boolean) => void;
  endNatively: () => void;
  dropSilently: () => void;
};
const VIEW = { width: 452, height: 680 };
test.use({ viewport: VIEW });

/** At once: the visible state follows the click within one frame or two. */
const FLIP = { timeout: 250 };

function annotateButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Annotate the screen\. Current tool:/ });
}

/** The synthetic native's state, read in the page. */
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const native = (window as unknown as { __dockComposerE2E: { native: Native } })
      .__dockComposerE2E.native;
    return {
      sessionId: native.sessionId,
      annotations: native.log.annotations.map((row) => ({ ...row })),
    };
  });
}

/** The synthetic native's open session: 'live', 'dictation', or none. */
async function nativeMode(page: Page): Promise<string> {
  const { sessionId, annotations } = await snapshot(page);
  if (!sessionId) return 'none';
  return annotations.filter((row) => row.id === sessionId).at(-1)?.mode ?? 'unknown';
}

async function lastTool(page: Page): Promise<string | undefined> {
  return (await snapshot(page)).annotations.at(-1)?.tool;
}

async function control(page: Page, call: 'endNatively' | 'dropSilently'): Promise<void> {
  await page.evaluate(
    (name) =>
      (window as unknown as { __dockComposerE2E: { native: Native } }).__dockComposerE2E.native[
        name
      ](),
    call,
  );
}

async function holdStarts(page: Page, value: boolean): Promise<void> {
  await page.evaluate(
    (held) =>
      (
        window as unknown as { __dockComposerE2E: { native: Native } }
      ).__dockComposerE2E.native.holdStarts(held),
    value,
  );
}

async function mount(mountFn: (c: typeof ComposerE2EHarness) => Promise<Locator>, page: Page) {
  await mountFn(ComposerE2EHarness);
  const button = annotateButton(page);
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await page.mouse.move(VIEW.width - 4, VIEW.height - 4);
  return button;
}

/** A real mouse press and release at the button's centre. */
async function press(page: Page, button: Locator): Promise<void> {
  const box = await button.boundingBox();
  if (!box) throw new Error('Missing annotate button bounds');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

async function expectOn(page: Page, button: Locator, mode: 'live' = 'live') {
  await expect(button).toHaveAttribute('aria-pressed', 'true', FLIP);
  await expect.poll(() => nativeMode(page)).toBe(mode);
}

async function expectOff(page: Page, button: Locator, mode: 'none' | 'dictation' = 'none') {
  await expect(button).toHaveAttribute('aria-pressed', 'false', FLIP);
  await expect.poll(() => nativeMode(page)).toBe(mode);
}

test('each click starts or ends at once, and native follows', async ({ mount: m, page }) => {
  const button = await mount(m, page);
  for (let round = 0; round < 3; round += 1) {
    await press(page, button);
    await expectOn(page, button);
    await press(page, button);
    await expectOff(page, button);
  }
});

test('rapid double and triple clicks end in the state of the last click', async ({
  mount: m,
  page,
}) => {
  const button = await mount(m, page);
  await button.dblclick();
  await expectOff(page, button);
  await button.click({ clickCount: 3 });
  await expectOn(page, button);
  await button.dblclick();
  await expectOn(page, button);
});

test('clicks while the tool popover opens, is open and is closing still toggle', async ({
  mount: m,
  page,
}) => {
  const button = await mount(m, page);
  const tools = page.getByRole('toolbar', { name: 'Annotation tools' });
  const box = (await button.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // Opening: inside the 150 ms hover delay.
  await page.mouse.move(centre.x, centre.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
  await expectOn(page, button);
  // Open.
  await page.mouse.move(VIEW.width - 4, VIEW.height - 4);
  await page.mouse.move(centre.x, centre.y);
  await expect(tools).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();
  await expectOff(page, button);
  await expect(tools).toHaveCount(0);
  // Closing: inside the 250 ms leave delay, back on the button.
  await page.mouse.move(VIEW.width - 4, VIEW.height - 4);
  await page.mouse.move(centre.x, centre.y);
  await expect(tools).toBeVisible();
  await page.mouse.move(centre.x - 60, centre.y + 30);
  await page.waitForTimeout(100);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.up();
  await expectOn(page, button);
  await press(page, button);
  await expectOff(page, button);
});

test('a click right after choosing a tool ends that session', async ({ mount: m, page }) => {
  const button = await mount(m, page);
  const tools = page.getByRole('toolbar', { name: 'Annotation tools' });
  await button.hover();
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Box' }).click();
  await expectOn(page, button);
  expect(await lastTool(page)).toBe('box');
  await press(page, button);
  await expectOff(page, button);
  await press(page, button);
  await expectOn(page, button);
  expect(await lastTool(page)).toBe('box');
});

test('toggling while the start is pending: a late confirmation never re-enables it', async ({
  mount: m,
  page,
}) => {
  const button = await mount(m, page);
  await holdStarts(page, true);
  await press(page, button);
  await expect(button).toHaveAttribute('aria-pressed', 'true', FLIP);
  await press(page, button);
  await expect(button).toHaveAttribute('aria-pressed', 'false', FLIP);
  await holdStarts(page, false);
  await expectOff(page, button);
  await page.waitForTimeout(200);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  // Pending, then confirmed: stays on.
  await holdStarts(page, true);
  await press(page, button);
  await expect(button).toHaveAttribute('aria-pressed', 'true', FLIP);
  await holdStarts(page, false);
  await expectOn(page, button);
});

test('a session native already ended never blocks the next clicks', async ({ mount: m, page }) => {
  const button = await mount(m, page);
  await press(page, button);
  await expectOn(page, button);
  // Native ended it (the overlay's X, a display change) and said so.
  await control(page, 'endNatively');
  await expectOff(page, button);
  await press(page, button);
  await expectOn(page, button);
  // Native lost it before its end event arrived: ending is refused natively.
  await control(page, 'dropSilently');
  await press(page, button);
  await expectOff(page, button);
  // The composer is still alive: the next clicks keep toggling.
  await press(page, button);
  await expectOn(page, button);
  await press(page, button);
  await expectOff(page, button);
});

test('annotate toggles while dictating; dictation alone opens no overlay', async ({
  mount: m,
  page,
}) => {
  const button = await mount(m, page);
  await page.getByRole('button', { name: /^Dictate/ }).click();
  await expect(page.getByRole('button', { name: 'Stop dictating' })).toBeVisible();
  await expect.poll(() => nativeMode(page)).toBe('none');
  await press(page, button);
  await expectOn(page, button);
  await press(page, button);
  await expectOff(page, button);
  await press(page, button);
  await expectOn(page, button);
});

test('keyboard: Enter toggles; Space opens the tools without toggling', async ({
  mount: m,
  page,
}) => {
  const button = await mount(m, page);
  await button.focus();
  await page.keyboard.press('Enter');
  await expectOn(page, button);
  await page.keyboard.press('Enter');
  await expectOff(page, button);
  await page.keyboard.press(' ');
  await expect(page.getByRole('toolbar', { name: 'Annotation tools' })).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});
