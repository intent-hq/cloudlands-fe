import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockPresenceBrowserHarness.svelte';

test.use({ video: 'on' });

test('notch ignores a brief pass and opens after 120 ms of continuous native presence', async ({
  mount,
  page,
}) => {
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.setViewportSize({ width: 640, height: 600 });
  await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  const emit = async (inside: boolean) =>
    page.evaluate((inside) => {
      const box = document.querySelector('[data-testid="dock-surface"]')!.getBoundingClientRect();
      (window as unknown as { __dockPresence: (presence: unknown) => void }).__dockPresence({
        inside,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        revision: 1,
      });
    }, inside);
  await emit(true);
  await page.clock.runFor(80);
  await emit(false);
  await page.clock.runFor(200);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await emit(true);
  await page.clock.runFor(60);
  await emit(true);
  await page.clock.runFor(59);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await page.clock.runFor(1);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await page.clock.runFor(400);
  await test
    .info()
    .attach('hover-threshold.json', {
      body: JSON.stringify({
        briefPassMs: 80,
        cancelled: true,
        closedAtMs: 119,
        openAtMs: 120,
        repeatedPresenceDoesNotRestart: true,
      }),
      contentType: 'application/json',
    });
  await test
    .info()
    .attach('expanded-notch', { body: await page.screenshot(), contentType: 'image/png' });
});

test('collapsed conversation waits for hover but keyboard opening remains immediate', async ({
  mount,
  page,
}) => {
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const component = await mount(Harness, { props: { workspaceId: 'workspace-one' } });
  const shell = page.getByTestId('dock-shell');
  const surface = page.getByTestId('dock-surface');
  await page.clock.runFor(500);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(500);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await surface.dispatchEvent('pointerover', { pointerType: 'mouse' });
  await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await page.clock.runFor(119);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await page.clock.runFor(1);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(500);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  await component.update({ props: { workspaceId: 'workspace-one', focusRequest: 1 } });
  await expect(shell).toHaveAttribute('data-expanded', 'true');
});

test('capture hiding cancels pending notch opening', async ({ mount, page }) => {
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  const component = await mount(Harness);
  const surface = page.getByTestId('dock-surface');
  await surface.dispatchEvent('pointerenter', { pointerType: 'mouse' });
  await page.clock.runFor(60);
  await component.update({ props: { hidden: true } });
  await page.clock.runFor(200);
  await component.update({ props: { hidden: false } });
  await page.clock.runFor(200);
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-expanded', 'false');
});

test('click focus opens the compact notch without waiting for hover', async ({ mount, page }) => {
  const now = new Date('2026-11-06T12:00:00Z');
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await mount(Harness);
  await page.getByTestId('dock-drag-handle').evaluate((grip: HTMLElement) => {
    grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
    grip.focus();
    grip.click();
  });
  await expect(page.getByTestId('dock-shell')).toHaveAttribute('data-expanded', 'true');
});

// The non-key dock window can stop receiving hover; main's cursor poll then reports
// presence. That report alone must open the compact notch and close it again.
test('main pointer presence alone expands the compact notch and collapses it on leave', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 600 });
  await mount(Harness);
  const shell = page.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  const surface = (await page.getByTestId('dock-surface').boundingBox())!;
  const point = { x: surface.x + surface.width / 2, y: surface.y + surface.height / 2 };
  const emit = (inside: boolean) =>
    page.evaluate(
      ({ inside, point }) =>
        (window as unknown as { __dockPresence: (presence: unknown) => void }).__dockPresence({
          inside,
          ...point,
          revision: 1,
        }),
      { inside, point },
    );

  await emit(true);
  await expect(shell).toHaveAttribute('data-expanded', 'true');
  await emit(false);
  await expect(shell).toHaveAttribute('data-expanded', 'false');
});
