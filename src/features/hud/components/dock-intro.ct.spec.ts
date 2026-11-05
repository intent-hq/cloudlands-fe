/**
 * The notch's "Meet the notch" card in a real browser, opened as the dock route
 * opens it: the notch expands with it on its own, it fits a short work area while
 * every workspace stays reachable, "Got it" and a confirmed "Turn off" retire it
 * by keyboard (and it stays retired after a reload), dismissal lets the notch
 * collapse, and a failed save keeps it without claiming anything.
 */
import { expect, test } from '../../../test/ct-test';
import DockIntroHarness from './__tests__/DockIntroHarness.svelte';
import { adaptiveDockFixture, dockRailPreview } from './dock-rail.preview-fixtures';

const SEEN_KEY = 'intent:dock-intro-seen:v1';
const SHORT = 360;

/**
 * A short display: the preview resolves every notch resize through main's own
 * surface resolver, which caps the open notch to the work area as production does.
 */
function shortNotch() {
  const base = dockRailPreview.states.notch.props;
  const placement = adaptiveDockFixture('notch');
  const display = {
    id: 1,
    bounds: { x: 0, y: 0, width: 640, height: SHORT },
    workArea: { x: 0, y: 0, width: 640, height: SHORT },
    cutout: placement.cutout,
  };
  return {
    ...base,
    viewportHeight: SHORT,
    floatingDisplay: display,
    placement: { ...placement, windowBounds: { ...placement.windowBounds, height: SHORT } },
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 640, height: SHORT });
  // Park the pointer away from the notch: anything open is the intro's doing.
  await page.mouse.move(630, SHORT - 10);
});

test('the notch opens with the intro, fits a short work area and keeps workspaces reachable', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(DockIntroHarness, {
    props: { ...shortNotch(), conversationFixture: true },
  });
  const shell = component.getByTestId('dock-shell');
  const card = component.getByTestId('dock-intro');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await expect(card).toBeVisible();
  await expect(
    card.getByRole('heading', { name: 'Your workspaces, one hover away' }),
  ).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(SHORT);
  // Capped to the work area: the open notch never runs off the display.
  await expect
    .poll(async () => {
      const surface = await component.locator('.companion').boundingBox();
      return surface ? surface.y + surface.height <= SHORT : false;
    })
    .toBe(true);
  // The Assistant stays in view below; every workspace scrolls into reach.
  const assistant = component.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
  await expect(assistant).toBeInViewport();
  const rows = component.locator('[data-dock-row]:not([data-workspace-id="dock:assistant"])');
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const png = testInfo.outputPath('notch-intro-short.png');
  await page.screenshot({ path: png });
  await testInfo.attach('notch intro (short work area)', { path: png, contentType: 'image/png' });
  await rows.first().scrollIntoViewIfNeeded();
  await rows.first().click();
  await expect(component.getByTestId('dock-conversation-surface')).toBeVisible();
});

test('"Got it" by keyboard retires the intro and lets the notch collapse', async ({
  mount,
  page,
}) => {
  const component = await mount(DockIntroHarness, { props: shortNotch() });
  const gotIt = component.getByRole('button', { name: 'Got it' });
  await gotIt.focus();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('dock-intro')).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBe('1');
  // Focus leaves the dock: with the pointer away too, nothing holds it open.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
  expect(JSON.parse((await component.getAttribute('data-saves')) ?? '[]')).toEqual([]);
});

test('a confirmed "Turn off" retires the intro for good', async ({ mount, page }) => {
  const component = await mount(DockIntroHarness, { props: shortNotch() });
  await component.getByRole('button', { name: 'Turn off' }).focus();
  await page.keyboard.press('Enter');
  await expect(component.getByTestId('dock-intro')).toHaveCount(0);
  expect(JSON.parse((await component.getAttribute('data-saves')) ?? '[]')).toEqual([
    { enabled: false },
  ]);
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBe('1');
  // A later dock (the user turns it back on) opens without the intro.
  await component.unmount();
  const again = await mount(DockIntroHarness, { props: shortNotch() });
  await expect(again.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '0');
  await expect(again.getByTestId('dock-intro')).toHaveCount(0);
});

for (const save of ['reject', 'mismatch'] as const) {
  test(`a ${save}ed "Turn off" keeps the intro and claims nothing`, async ({ mount, page }) => {
    const component = await mount(DockIntroHarness, { props: { ...shortNotch(), save } });
    const turnOff = component.getByRole('button', { name: 'Turn off' });
    await turnOff.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => JSON.parse((await component.getAttribute('data-saves')) ?? '[]'))
      .toEqual([{ enabled: false }]);
    await expect(turnOff).toBeEnabled();
    await expect(component.getByTestId('dock-intro')).toBeVisible();
    await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
    expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBeNull();
  });
}

test('a conversation opened from the intro never holds the notch open after it closes', async ({
  mount,
  page,
}) => {
  const component = await mount(DockIntroHarness, {
    props: { ...shortNotch(), conversationFixture: true },
  });
  const shell = component.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-reveal', '1');
  await component.locator('[data-dock-row]').first().click();
  const surface = component.getByTestId('dock-conversation-surface');
  await expect(surface).toBeVisible();
  // Escape leaves the conversation; with the pointer away the notch collapses.
  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(630, SHORT - 10);
  await expect(shell).toHaveAttribute('data-reveal', '0');
  // Not secretly dismissed: the intro still waits for "Got it" on the next open,
  // and the conversation reopens from the same row.
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBeNull();
  await component.getByTestId('dock-drag-handle').focus();
  await expect(component.getByTestId('dock-intro')).toBeVisible();
  await component.locator('[data-dock-row]').first().click();
  await expect(component.getByTestId('dock-conversation-surface')).toBeVisible();
});

test('the intro at normal height (screenshot for review)', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 600 });
  await page.mouse.move(630, 590);
  const component = await mount(DockIntroHarness, { props: dockRailPreview.states.notch.props });
  await expect(component.getByTestId('dock-intro')).toBeVisible();
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
  const png = testInfo.outputPath('notch-intro-normal.png');
  await page.screenshot({ path: png });
  await testInfo.attach('notch intro (normal)', { path: png, contentType: 'image/png' });
});
