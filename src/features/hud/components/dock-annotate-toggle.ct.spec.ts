import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import ComposerE2EHarness from './DockComposerE2EHarness.svelte';

/**
 * The annotate button keeps session state consistent across clicks: production composer, controller, sagas and tool popover; only the
 * native helper is synthetic (it answers like main: a replaced or ended session
 * is refused, and native may end a session on its own).
 *
 * Visible state and the synthetic native must settle in the matching state.
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

async function expectOn(page: Page, button: Locator, mode: 'live' = 'live') {
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => nativeMode(page)).toBe(mode);
}

async function expectOff(page: Page, button: Locator, mode: 'none' | 'dictation' = 'none') {
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => nativeMode(page)).toBe(mode);
}

test('each click starts or ends the native annotation session', async ({ mount: m, page }) => {
  const button = await mount(m, page);
  for (let round = 0; round < 3; round += 1) {
    await button.click();
    await expectOn(page, button);
    await button.click();
    await expectOff(page, button);
  }
});

test('a click right after choosing a tool ends that session', async ({ mount: m, page }) => {
  const button = await mount(m, page);
  const tools = page.getByRole('toolbar', { name: 'Annotation tools' });
  await button.focus();
  await button.press(' ');
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Box' }).click();
  await expectOn(page, button);
  expect(await lastTool(page)).toBe('box');
  await button.click();
  await expectOff(page, button);
  await button.click();
  await expectOn(page, button);
  expect(await lastTool(page)).toBe('box');
});

test('toggling while the start is pending: a late confirmation never re-enables it', async ({
  mount: m,
  page,
}) => {
  const button = await mount(m, page);
  await holdStarts(page, true);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await holdStarts(page, false);
  await expectOff(page, button);
  await page.waitForTimeout(200);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  // Pending, then confirmed: stays on.
  await holdStarts(page, true);
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await holdStarts(page, false);
  await expectOn(page, button);
});

test('a session native already ended never blocks the next clicks', async ({ mount: m, page }) => {
  const button = await mount(m, page);
  await button.click();
  await expectOn(page, button);
  // Native ended it (the overlay's X, a display change) and said so.
  await control(page, 'endNatively');
  await expectOff(page, button);
  await button.click();
  await expectOn(page, button);
  // Native lost it before its end event arrived: ending is refused natively.
  await control(page, 'dropSilently');
  await button.click();
  await expectOff(page, button);
  // The composer is still alive: the next clicks keep toggling.
  await button.click();
  await expectOn(page, button);
  await button.click();
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
  await button.click();
  await expectOn(page, button);
  await button.click();
  await expectOff(page, button);
  await button.click();
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
