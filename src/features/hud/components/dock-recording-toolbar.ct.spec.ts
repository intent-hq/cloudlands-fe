/**
 * The recording tool bar (Recording toolbar spec, Nov 2026), through the real
 * component with main and the dock replaced at the toolbar boundary
 * (`DockRecordingToolbarHarness`). One test per acceptance criterion, plus light and
 * dark captures of the spec's four states.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, expectAnimationsToSettle, test } from '../../../test/ct-test';
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
  // eslint-disable-next-line intent/no-unpaused-clock-in-ct -- mount and motion need moving time; every test that steps time calls pauseClock first
  await page.clock.install({ time: new Date('2026-11-03T12:00:00Z') });
  // Keep the pointer off the bar: hover changes the chip.
  await page.mouse.move(5, 395);
});

test('Pointer sits alone; Element selector, Rectangle, Draw and Arrow sit in the well in order', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  // Pointer is the first tool and the only one outside the well.
  await expect(bar(page).locator('[data-tool]').first()).toHaveAttribute('data-tool', 'pointer');
  await expect(bar(page).locator('.well [data-tool="pointer"]')).toHaveCount(0);
  const well = await bar(page)
    .locator('.well [data-tool]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tool')));
  expect(well).toEqual(['pick', 'box', 'pen', 'arrow']);
  await expect(bar(page)).toHaveAttribute('role', 'toolbar');
  await expect(bar(page)).toHaveAccessibleName('Recording tools');
});

test('exactly one tool is selected as tools change', async ({ mount, page }) => {
  await mount(Harness);
  const checked = bar(page).locator('[role="radio"][aria-checked="true"]');
  await expect(checked).toHaveCount(1);
  await expect(checked).toHaveAttribute('data-tool', 'pointer');
  for (const name of ['pick', 'box', 'pen', 'arrow', 'pointer']) {
    await tool(page, name).click();
    await expect(checked).toHaveCount(1);
    await expect(checked).toHaveAttribute('data-tool', name);
  }
});

test('Clear is absent with no marks, appears with the first mark around a fixed centre, and clears to Pointer', async ({
  mount,
  page,
}) => {
  // No live mic level: the waveform's motion would keep the bar animating.
  const harness = await mount(Harness, { props: { signal: null } });
  // Step time by hand from here: a moving fake clock races the checks.
  await pauseClock(page);
  await expect(bar(page).locator('[data-clear]')).toHaveCount(0);
  await expectAnimationsToSettle(bar(page));
  const before = (await bar(page).boundingBox())!;
  await page.getByRole('button', { name: 'Draw a mark' }).click();
  await expect(bar(page).locator('[data-clear]')).toBeVisible();
  // The bar grows smoothly: it has animations while Clear comes in.
  await page.clock.runFor(400);
  await expectAnimationsToSettle(bar(page));
  const after = (await bar(page).boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 30);
  // Centre fixed: nothing jumps under the pointer.
  expect(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2))).toBeLessThanOrEqual(
    1,
  );
  await bar(page).locator('[data-clear]').click();
  expect((await actions(harness)).slice(-2)).toEqual(['clear', 'mouse']);
  await expect(bar(page).locator('[data-clear]')).toHaveCount(0);
  await expect(tool(page, 'pointer')).toHaveAttribute('aria-checked', 'true');
});

test('hovering the chip while recording swaps the dot for a pause icon', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  const chip = page.getByTestId('recording-chip');
  const opacity = (selector: string) =>
    chip.locator(selector).evaluate((node) => getComputedStyle(node).opacity);
  expect(await opacity('.rec-dot')).toBe('1');
  expect(await opacity('.hover-pause')).toBe('0');
  await chip.hover();
  expect(await opacity('.rec-dot')).toBe('0');
  expect(await opacity('.hover-pause')).toBe('1');
});

test('clicking the chip pauses and resumes; paused shows a play icon and a flat waveform', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness);
  // Step time by hand from here: a moving fake clock races the checks.
  await pauseClock(page);
  const chip = page.getByTestId('recording-chip');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toHaveAccessibleName('Pause recording, 0:42 elapsed');
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
  await expect(chip.locator('[data-recording-time]')).toHaveText('0:42');
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(page).getByRole('status').last()).toHaveText('Recording');
  await page.clock.runFor(3000);
  await expect(chip.locator('[data-recording-time]')).toHaveText('0:45');
});

test('X discards with a 5 s Undo on the bar; Undo restores it, otherwise the recording goes', async ({
  mount,
  page,
}) => {
  const harness = await mount(Harness, { props: { marked: true } });
  // Step time by hand from here: a moving fake clock races the checks.
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
    ['e', 'pick'],
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
  await expect(tool(page, 'pick')).toBeFocused();
});

test('tooltips: every control names itself and its bar key on hover, never taking focus or moving the bar, and flip below at the top edge', async ({
  mount,
  page,
}, info) => {
  await mount(Harness);
  // Step time by hand from here: a moving fake clock races the checks.
  await pauseClock(page);
  // The focused control shows its own tooltip too; each is found by its text.
  const tip = (text: string) =>
    page.getByRole('tooltip').filter({ visible: true }).filter({ hasText: text });
  const hover = async (target: Locator) => {
    await target.hover();
    // The shared tooltip opens after its short delay.
    await page.clock.runFor(400);
  };
  // Focus sits on Element selector; hovering elsewhere must not move it.
  await tool(page, 'pointer').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tool(page, 'pick')).toBeFocused();
  const placed = await bar(page).boundingBox();

  for (const [name, label, key] of [
    ['pointer', 'Pointer', 'V'],
    ['pick', 'Element selector', 'E'],
    ['box', 'Rectangle', 'R'],
    ['pen', 'Draw', 'D'],
    ['arrow', 'Arrow', 'A'],
  ] as const) {
    await hover(tool(page, name));
    await expect(tip(label)).toBeVisible();
    await expect(tip(label).locator('kbd').first()).toContainText(key);
  }
  await hover(page.getByTestId('recording-chip'));
  await expect(tip('Pause')).toBeVisible();
  await hover(bar(page).locator('[data-discard]'));
  await expect(tip('Discard recording')).toBeVisible();
  await hover(bar(page).locator('[data-done]'));
  await expect(tip('Done')).toBeVisible();
  await info.attach('tooltip-done', { body: await page.screenshot(), contentType: 'image/png' });
  await page.screenshot({ path: info.outputPath('recording-toolbar-tooltip.png') });
  await hover(bar(page).locator('[data-grip]'));
  await expect(tip('Drag to move')).toBeVisible();
  await expect(tool(page, 'pick')).toBeFocused();
  expect(await bar(page).boundingBox()).toEqual(placed);

  // A click is still a click: the tool is chosen.
  await tool(page, 'box').click();
  await expect(tool(page, 'box')).toHaveAttribute('aria-checked', 'true');

  // Dragged to the top edge, the tooltip flips below the bar and stays on screen.
  const grip = (await bar(page).locator('[data-grip]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, 2, { steps: 4 });
  await page.mouse.up();
  await hover(tool(page, 'arrow'));
  await expect(tip('Arrow')).toBeVisible();
  const tipBox = (await tip('Arrow').boundingBox())!;
  const button = (await tool(page, 'arrow').boundingBox())!;
  // Below its button (not above the bar, where there is no room), and on screen.
  expect(tipBox.y).toBeGreaterThanOrEqual(button.y + button.height);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(400);
  await page.screenshot({ path: info.outputPath('recording-toolbar-tooltip-top-edge.png') });
});

test('no microphone: the waveform is flat and the chip says so', async ({ mount, page }) => {
  await mount(Harness, { props: { signal: { level: 0, mic: false } } });
  // Step time by hand from here: a moving fake clock races the checks.
  await pauseClock(page);
  const chip = page.getByTestId('recording-chip');
  await expect(chip.locator('.wave')).toHaveAttribute('data-flat');
  await chip.hover();
  await page.clock.runFor(400);
  await expect(page.getByRole('tooltip').filter({ visible: true })).toContainText('No mic input');
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

for (const scheme of ['light', 'dark'] as const) {
  test(`states in ${scheme} (screenshots for review)`, async ({ mount, page }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const capture = async (name: string) => {
      await expectAnimationsToSettle(bar(page));
      const box = (await bar(page).boundingBox())!;
      await page.screenshot({
        path: testInfo.outputPath(`recording-toolbar-${scheme}-${name}.png`),
        clip: { x: box.x - 24, y: box.y - 56, width: box.width + 48, height: box.height + 80 },
      });
    };
    const empty = await mount(Harness);
    // Step time by hand from here: a moving fake clock races the checks.
    await pauseClock(page);
    await page.clock.runFor(500);
    await capture('1-nothing-drawn');
    await page.getByRole('button', { name: 'Draw a mark' }).click();
    await tool(page, 'box').click();
    await page.mouse.move(5, 395);
    await page.clock.runFor(500);
    await capture('2-marks-drawn');
    await page.getByTestId('recording-chip').hover();
    await capture('3-hover-chip');
    await page.getByTestId('recording-chip').click();
    await tool(page, 'pointer').click();
    await page.mouse.move(5, 395);
    await capture('4-paused');
    await empty.unmount();
  });
}
