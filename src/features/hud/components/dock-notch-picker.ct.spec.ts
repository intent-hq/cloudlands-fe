/**
 * The notch conversation's model picker, through the real shell (DockRail →
 * AdaptiveDockShell → DockConversationSurface → DockConversation → ModelPicker) over
 * the wire fixtures' synthetic daemon. In Electron, main ignores the mouse at any
 * point outside the published pointer regions, so each control is checked where it
 * is clicked: the point must be inside a region, the topmost element there must be
 * that control, and the conversation must still be disclosed. The pointer also
 * crosses from the composer into the body-level picker portal; a presence collapse
 * on that crossing would close the conversation under the picker.
 */
import type { Locator, Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockNotchPickerHarness.svelte';

type Rect = { x: number; y: number; width: number; height: number };

const frames = (page: Page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Region coverage and DOM hit-test at a page point (the preview window sits at 0,0). */
async function probe(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const fixture = document.querySelector('[data-preview-pointer]')!;
      const host = fixture.querySelector('.dock-preview-host')!.getBoundingClientRect();
      const pointer = JSON.parse(fixture.getAttribute('data-preview-pointer')!) as {
        active: boolean;
        regions: Rect[];
      };
      const hit = document.elementFromPoint(x, y);
      return {
        point: { x, y },
        host: { x: host.x, y: host.y },
        active: pointer.active,
        covered: pointer.regions.some(
          (r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
        ),
        hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}` : null,
        surface: !!document.querySelector('[data-testid="dock-conversation-surface"]'),
      };
    },
    { x, y },
  );
}

const log: unknown[] = [];

// Evidence for review (and diagnosis on failure): every probe and every daemon call.
test.afterEach(async ({ page }, testInfo) => {
  const calls = await page
    .locator('[data-testid="notch-picker-harness"]')
    .getAttribute('data-calls')
    .catch(() => '[]');
  await writeFile(
    testInfo.outputPath('notch-picker-evidence.json'),
    JSON.stringify({ log, calls: JSON.parse(calls ?? '[]') }, null, 2),
  );
});

/** Rest on the control, then require native routing and the DOM hit to reach it. */
async function clickable(page: Page, control: Locator, label: string): Promise<void> {
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await frames(page);
  const sample = await probe(page, x, y);
  const owns = await control.evaluate(
    (element, point) => element.contains(document.elementFromPoint(point.x, point.y)),
    { x, y },
  );
  log.push({ label, ...sample, owns });
  expect({ label, ...sample, owns }).toMatchObject({
    host: { x: 0, y: 0 },
    active: true,
    covered: true,
    surface: true,
    owns: true,
  });
}

test('the notch model picker: provider, effort and model are clickable through the shell', async ({
  mount,
  page,
}, testInfo) => {
  // The preview's native window is 640×600 at the page origin: page = window coordinates.
  await page.setViewportSize({ width: 640, height: 600 });
  const harness = await mount(Harness, { props: { providerChoice: true } });
  await harness.getByTestId('dock-drag-handle').hover();
  await harness.locator('[data-dock-row]').first().click();
  const surface = harness.getByTestId('dock-conversation-surface');
  const trigger = surface.locator('[data-chat-input-primary-actions]').getByRole('button').first();
  await expect(trigger).toContainText('Opus 4.7');
  await clickable(page, trigger, 'model trigger');
  await trigger.click();
  const panel = page.locator('.model-picker-panel');
  const sonnet = panel.getByRole('option', { name: /Sonnet 4\.5/ });
  await expect(sonnet).toBeVisible();

  // Cross from the composer trigger into the portaled picker, sampling every step.
  const from = (await trigger.boundingBox())!;
  const to = (await sonnet.boundingBox())!;
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const end = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  for (let i = 1; i <= 16; i += 1) {
    const x = start.x + ((end.x - start.x) * i) / 16;
    const y = start.y + ((end.y - start.y) * i) / 16;
    await page.mouse.move(x, y);
    await frames(page);
    const sample = await probe(page, x, y);
    log.push({ label: `crossing ${i}`, ...sample });
    expect(sample, `crossing ${i}`).toMatchObject({ active: true, covered: true, surface: true });
  }
  // Rest past the presence settle (a quiet period): a pending collapse would land here.
  // eslint-disable-next-line intent/no-wait-for-timeout-in-ct -- quiet period: nothing may collapse while the pointer rests on the portal
  await page.waitForTimeout(600);
  await expect(panel).toBeVisible();

  // Alternate provider and back.
  const rail = panel.getByTestId('model-provider-rail');
  const claude = rail.getByRole('tab', { name: /Claude/ });
  await clickable(page, claude, 'claude provider');
  await claude.click();
  await expect(panel.getByRole('option', { name: /Claude fixture/ })).toBeVisible();
  const auggie = rail.getByRole('tab', { name: /Auggie/ });
  await clickable(page, auggie, 'auggie provider');
  await auggie.click();
  await expect(sonnet).toBeVisible();

  // Effort: the nested select inside the picker panel.
  const effort = panel.getByTestId('effort-picker-trigger');
  await clickable(page, effort, 'effort trigger');
  await effort.click();
  const high = page.getByRole('option', { name: /^High/ });
  await clickable(page, high, 'effort high');
  await high.click();
  await expect(effort).toContainText('High');

  // Alternate model: the mid-conversation switch is confirmed in a dialog.
  await clickable(page, sonnet, 'sonnet option');
  await sonnet.click();
  const dialog = page.getByRole('dialog', { name: 'Switch model?' });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: /^Switch/ });
  await clickable(page, confirm, 'confirm switch');
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(trigger).toContainText('Sonnet 4.5');

  await page.screenshot({ path: testInfo.outputPath('notch-picker-final.png') });
});
