/**
 * The recording tool bar (Recording toolbar spec, Nov 2026), through the real
 * component with main and the dock replaced at the toolbar boundary
 * (`DockRecordingToolbarHarness`). Functional and accessible behavior only;
 * visual captures are manual review evidence.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../test/ct-test';
import { pauseClock } from '../../../test/ct-clock';
import Harness from './__tests__/DockRecordingToolbarHarness.svelte';

type Request = { action: string; tool?: string; paused?: boolean };
const requests = async (harness: Locator) =>
  JSON.parse((await harness.getAttribute('data-requests')) ?? '[]') as Request[];
const actions = async (harness: Locator) => (await requests(harness)).map((row) => row.action);
const bar = (page: Page) => page.getByTestId('dock-recording-toolbar');
const tool = (page: Page, name: string) => bar(page).locator(`[data-tool="${name}"]`);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 400 });
  // eslint-disable-next-line intent/no-unpaused-clock-in-ct -- mount needs moving time; cases stepping time call pauseClock first
  await page.clock.install({ time: new Date('2026-11-03T12:00:00Z') });
  // Keep the pointer off the bar: hover changes the chip.
  await page.mouse.move(5, 395);
});

test('exactly one tool is selected as tools change', async ({ mount, page }) => {
  await mount(Harness);
  await expect(bar(page)).toHaveAttribute('role', 'toolbar');
  await expect(bar(page)).toHaveAccessibleName('Recording tools');
  const checked = bar(page).locator('[role="radio"][aria-checked="true"]');
  await expect(checked).toHaveCount(1);
  await expect(checked).toHaveAttribute('data-tool', 'pointer');
  for (const name of ['box', 'pen', 'arrow', 'pointer']) {
    await tool(page, name).click();
    await expect(checked).toHaveCount(1);
    await expect(checked).toHaveAttribute('data-tool', name);
  }
});

test('Clear appears with the first mark and clears to Pointer', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, { props: { signal: null } });
  await pauseClock(page);
  await expect(bar(page).locator('[data-clear]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Draw a mark' }).click();
  await expect(bar(page).locator('[data-clear]')).toBeVisible();
  await bar(page).locator('[data-clear]').click();
  expect((await actions(harness)).slice(-2)).toEqual(['clear', 'mouse']);
  await expect(bar(page).locator('[data-clear]')).toHaveCount(0);
  await expect(tool(page, 'pointer')).toHaveAttribute('aria-checked', 'true');
});

test('clicking the chip pauses and resumes; paused shows a play icon and a flat waveform', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness);
  await pauseClock(page);
  const chip = page.getByTestId('recording-chip');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  const time = chip.locator('[data-recording-time]');
  const shown = (await time.textContent())?.trim() ?? '';
  const seconds = Number(shown.split(':')[1]);
  expect(seconds).toBeGreaterThanOrEqual(42);
  await expect(chip).toHaveAccessibleName(`Pause recording, ${shown} elapsed`);
  await chip.click();
  expect(await requests(harness)).toContainEqual({
    sessionId: expect.any(String),
    action: 'pause',
    paused: true,
  });
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip.locator('[data-dock-glyph="play"]')).toBeVisible();
  await expect(chip.locator('.wave')).toHaveAttribute('data-flat');
  await expect(bar(page).getByRole('status').last()).toHaveText('Paused');
  // Elapsed time stops while paused.
  await page.clock.runFor(5000);
  await expect(time).toHaveText(shown);
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(page).getByRole('status').last()).toHaveText('Recording');
  await page.clock.runFor(3000);
  await expect(time).toHaveText(`0:${seconds + 3}`);
});

test('X discards with a 5 s Undo on the bar; Undo restores it, otherwise the recording goes', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, { props: { marked: true } });
  await pauseClock(page);
  await bar(page).locator('[data-discard]').click();
  const pill = page.getByTestId('recording-discarded');
  await expect(pill).toContainText('Recording discarded');
  expect(await actions(harness)).toContain('discard');
  await pill.getByRole('button', { name: 'Undo' }).click();
  await expect(pill).toHaveCount(0);
  await expect(page.getByTestId('recording-chip')).toBeVisible();
  expect((await actions(harness)).at(-1)).toBe('discard-undo');
  // Again, and let the undo window run out.
  await bar(page).locator('[data-discard]').click();
  await page.clock.runFor(4900);
  expect(await actions(harness)).not.toContain('discard-confirm');
  await page.clock.runFor(200);
  await expect.poll(() => actions(harness)).toContain('discard-confirm');
  await expect(harness).toHaveAttribute('data-shown', 'false');
});

for (const paused of [false, true]) {
  test(`Done attaches the recording from the ${paused ? 'paused' : 'recording'} state`, async ({
    mount,
    page,
  }) => {
    const harness = await mount(Harness, { props: { paused } });
    await bar(page).locator('[data-done]').click();
    expect((await actions(harness)).at(-1)).toBe('done');
    await expect(harness).toHaveAttribute('data-shown', 'false');
  });
}

test('shortcuts select tools, pause and finish, and never fire while typing in a page field', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness);
  const checked = bar(page).locator('[role="radio"][aria-checked="true"]');
  for (const [key, name] of [
    ['r', 'box'],
    ['d', 'pen'],
    ['a', 'arrow'],
    ['v', 'pointer'],
  ]) {
    await page.keyboard.press(key);
    await expect(checked).toHaveAttribute('data-tool', name);
  }
  await page.keyboard.press('r');
  await page.keyboard.press('Escape');
  await expect(checked).toHaveAttribute('data-tool', 'pointer');
  await page.keyboard.press(' ');
  await expect(page.getByTestId('recording-chip')).toHaveAttribute('aria-pressed', 'true');
  // Typing in the page goes to the field only.
  const count = (await actions(harness)).length;
  await page.getByTestId('page-field').fill('');
  await page.getByTestId('page-field').pressSequentially('vera dare ');
  await page.getByTestId('page-field').press('Enter');
  expect((await actions(harness)).length).toBe(count);
  await page.getByTestId('page-field').blur();
  await page.keyboard.press('Enter');
  expect((await actions(harness)).at(-1)).toBe('done');
});

test('arrow keys move focus between the bar buttons', async ({ mount, page }) => {
  await mount(Harness);
  await tool(page, 'pointer').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tool(page, 'box')).toBeFocused();
});

test('no microphone: the waveform is flat', async ({ mount, page }) => {
  await mount(Harness, { props: { signal: { level: 0, mic: false } } });
  const chip = page.getByTestId('recording-chip');
  await expect(chip.locator('.wave')).toHaveAttribute('data-flat');
});

test('long recordings switch to h:mm:ss', async ({ mount, page }) => {
  await mount(Harness, { props: { elapsedMs: (3600 + 62) * 1000 } });
  await expect(page.getByTestId('recording-chip').locator('[data-recording-time]')).toHaveText(
    '1:01:02',
  );
});

test('narrow windows keep every control and scale the bar down', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 400 });
  await mount(Harness, { props: { marked: true, width: 360 } });
  const box = (await bar(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  for (const selector of ['[data-tool]', '[data-clear]', '[data-discard]', '[data-done]'])
    await expect(bar(page).locator(selector).first()).toBeVisible();
});

test('removed Element tool has no button or E binding', async ({ mount, page }, info) => {
  const harness = await mount(Harness);
  await expect(tool(page, 'pick')).toHaveCount(0);
  const before = await actions(harness);
  await page.keyboard.press('e');
  expect(await actions(harness)).toEqual(before);
  await expect(tool(page, 'pointer')).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: info.outputPath('no-element-toolbar.png') });
});
