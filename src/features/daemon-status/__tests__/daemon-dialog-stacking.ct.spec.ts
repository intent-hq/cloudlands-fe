import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../test/ct-test';
import Harness from './DaemonDialogStackingHarness.svelte';

test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });

async function hitTest(control: Locator) {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return element.contains(
      document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
    );
  });
}

async function ownsFocus(dialog: Locator) {
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
}

async function aboveScreen(dialog: Locator, screen: Locator) {
  const dialogLayer = await dialog.evaluate((element) => Number(getComputedStyle(element).zIndex));
  const screenLayer = await screen.evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(dialogLayer).toBeGreaterThan(screenLayer);
}

async function capture(page: Page, testInfo: TestInfo, stage: string) {
  await page.evaluate(() => document.fonts.ready);
  const directory = resolve(process.env.DAEMON_DIALOG_EVIDENCE ?? testInfo.outputDir);
  await mkdir(directory, { recursive: true });
  const name = `${testInfo.title.replace(/[^a-z0-9]+/gi, '-')}-${stage}`;
  const geometry = await page
    .locator('[role="dialog"], [role="alertdialog"]')
    .evaluateAll((dialogs) =>
      dialogs.map((dialog) => {
        const box = dialog.getBoundingClientRect();
        return {
          title: dialog.querySelector('h2')?.textContent?.trim(),
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          layer: getComputedStyle(dialog).zIndex,
          ownsFocus: dialog.contains(document.activeElement),
          controls: Array.from(dialog.querySelectorAll('button')).map((button) => {
            const bounds = button.getBoundingClientRect();
            return {
              name: button.getAttribute('aria-label') ?? button.textContent?.trim(),
              hit: button.contains(
                document.elementFromPoint(
                  bounds.x + bounds.width / 2,
                  bounds.y + bounds.height / 2,
                ),
              ),
            };
          }),
        };
      }),
    );
  const json = resolve(directory, `${name}.json`);
  const screenshot = resolve(directory, `${name}.png`);
  await writeFile(json, JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: screenshot });
  await testInfo.attach(`${stage}-hit-tests`, { path: json, contentType: 'application/json' });
  await testInfo.attach(stage, { path: screenshot, contentType: 'image/png' });
}

for (const state of ['external', 'updating']) {
  for (const first of ['connection', 'notes']) {
    test(`${state}: ${first} first keeps release notes above the connection screen`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.clock.install();
      const component = await mount(Harness, {
        props: { scenario: state, notesOpen: first === 'notes' },
      });
      await page.clock.runFor(2600);
      if (first === 'connection') await component.update({ props: { notesOpen: true } });
      const notes = page.getByRole('dialog');
      const screen = page.getByTestId(
        state === 'updating' ? 'daemon-updating-overlay' : 'daemon-stopped-overlay',
      );
      await expect(screen).toBeVisible();
      await expect(notes).toBeVisible();
      await capture(page, testInfo, 'overlap');

      // Painting order must agree with the dialog library's pointer and focus owner.
      await aboveScreen(notes, screen);
      await expect
        .poll(() => hitTest(notes.getByRole('button', { name: 'Got it', exact: true })))
        .toBe(true);
      await ownsFocus(notes);
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let index = 0; index < 4; index++) {
          await page.keyboard.press(key);
          await ownsFocus(notes);
        }
      }
      if (state === 'updating') {
        await page.clock.runFor(8000);
        await expect(screen).toHaveCount(0);
        await aboveScreen(notes, page.getByTestId('daemon-stopped-overlay'));
        await ownsFocus(notes);
      }

      await notes.getByRole('button', { name: 'Got it', exact: true }).click();
      await expect(notes).toHaveCount(0);
      await expect(page.getByTestId('dialog-stacking-actions')).toHaveAttribute(
        'data-dismissals',
        '1',
      );
      await expect(page.getByTestId('daemon-stopped-overlay')).toBeVisible();
      if (state === 'external') {
        await expect
          .poll(() => hitTest(page.getByTestId('daemon-stopped-spawn-sidecar')))
          .toBe(true);
      } else {
        await expect(page.getByTestId('daemon-stopped-overlay')).toContainText(
          'The app is restarting it automatically.',
        );
      }
      await expect
        .poll(() => hitTest(page.getByRole('button', { name: 'Background action', exact: true })))
        .toBe(false);
      await capture(page, testInfo, 'recovery');
      await component.update({ props: { connected: true } });
      await expect(page.getByTestId('daemon-stopped-overlay')).toHaveCount(0);
      await page.getByRole('button', { name: 'Background action', exact: true }).click();
      await expect(page.getByTestId('dialog-stacking-actions')).toHaveAttribute(
        'data-background',
        '1',
      );
    });
  }
}

for (const notesStatus of ['loading', 'unavailable'] as const) {
  test(`${notesStatus} notes retain keyboard dismissal over recovery in a narrow dark window`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 600 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.clock.install();
    await mount(Harness, { props: { notesOpen: true, notesStatus } });
    await page.clock.runFor(2600);
    const notes = page.getByRole('dialog');
    await expect(notes).toBeVisible();
    await aboveScreen(notes, page.getByTestId('daemon-stopped-overlay'));
    await ownsFocus(notes);
    const dismiss = notes.getByRole('button', { name: 'Got it', exact: true });
    await expect.poll(() => hitTest(dismiss)).toBe(true);
    const bounds = await dismiss.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
    await capture(page, testInfo, 'overlap');
    await page.keyboard.press('Escape');
    await expect(notes).toHaveCount(0);
    await expect(page.getByTestId('dialog-stacking-actions')).toHaveAttribute(
      'data-dismissals',
      '1',
    );
    await expect.poll(() => hitTest(page.getByTestId('daemon-stopped-spawn-sidecar'))).toBe(true);
  });
}

test('reconnection preserves the open release notes and reading position', async ({
  mount,
  page,
}, testInfo) => {
  await page.clock.install();
  const component = await mount(Harness, { props: { notesOpen: true } });
  await page.clock.runFor(2600);
  const notes = page.getByRole('dialog');
  const body = notes.locator('[data-slot="dialog-body"]');
  await body.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const scrollTop = await body.evaluate((element) => element.scrollTop);
  await component.update({ props: { connected: true } });
  await expect(page.getByTestId('daemon-stopped-overlay')).toHaveCount(0);
  await expect(notes).toBeVisible();
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await ownsFocus(notes);
  await capture(page, testInfo, 'reconnected');
  await notes.getByRole('button', { name: 'Got it', exact: true }).click();
  await expect(page.getByTestId('dialog-stacking-actions')).toHaveAttribute('data-dismissals', '1');
});

for (const state of ['auth-rejected', 'guest-offline']) {
  test(`${state} recovery opens an operable child dialog after notes close`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.clock.install();
    await mount(Harness, { props: { scenario: state, notesOpen: true } });
    await page.clock.runFor(2600);
    const notes = page.getByRole('dialog');
    await aboveScreen(notes, page.getByTestId('daemon-stopped-overlay'));
    await notes.getByRole('button', { name: 'Got it', exact: true }).click();
    const recovery = page.getByTestId(
      state === 'auth-rejected' ? 'daemon-stopped-repair' : 'daemon-stopped-guest-leave',
    );
    await expect.poll(() => hitTest(recovery)).toBe(true);
    await recovery.click();
    const child = page.locator('[data-slot="dialog-content"]');
    await expect(child).toBeVisible();
    await aboveScreen(child, page.getByTestId('daemon-stopped-overlay'));
    await ownsFocus(child);
    await page.keyboard.press('Tab');
    await ownsFocus(child);
    await capture(page, testInfo, 'child-dialog');
    await page.keyboard.press('Escape');
    await expect(child).toHaveCount(0);
    await expect.poll(() => hitTest(recovery)).toBe(true);
    await expect(page.getByTestId('dialog-stacking-actions')).toHaveAttribute(
      'data-background',
      '0',
    );
  });
}
