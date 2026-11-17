import { expect, test } from '../../test/ct-test';
import Harness from './DaemonRailHarness.svelte';

test.use({ reducedMotion: 'reduce' });

for (const scenario of [
  'updating',
  'external',
  'daemon-starting',
  'daemon-start-failed',
  'startup',
  'limited',
  'auth-rejected',
  'auth-disabled',
  'guest-offline',
  'guest-revoked',
]) {
  test(`${scenario} keeps the device rail usable during recovery`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 600 });
    if (scenario.startsWith('guest-') || scenario === 'updating') {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
    }
    // eslint-disable-next-line intent/no-unpaused-clock-in-ct -- skips recovery delays while allowing component transitions to settle
    await page.clock.install();
    await mount(Harness, { props: { scenario } });
    await page.clock.runFor(2600);
    const screen = page.getByTestId(
      scenario === 'updating' ? 'daemon-updating-overlay' : 'daemon-stopped-overlay',
    );
    await expect(screen).toBeVisible();
    await expect(screen).not.toHaveAttribute('aria-modal', 'true');
    const local = page.locator('[data-testid="machine-rail-item"][data-machine-id="local"]');
    await expect(local).toBeVisible();
    await page.getByTestId('window-control').click();
    await info.attach('device-recovery', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    if (scenario === 'daemon-starting') {
      await local.focus();
      await local.press('Enter');
    } else {
      await local.click();
    }
    await expect(screen).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep this draft');
    await page.getByRole('textbox', { name: 'Draft' }).fill('My other device draft');
    await page.locator('[data-testid="machine-rail-item"][data-machine-id="audit-host"]').click();
    await page.clock.runFor(2600);
    await expect(screen).toBeVisible();
    await expect(page.getByTestId('rail-recovery-state')).toHaveAttribute('data-background', '0');
    await info.attach('returned-to-recovery', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    if (scenario === 'updating') {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await info.attach('desktop-update-light', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  });
}

test('a short window can scroll to recovery actions while the rail stays reachable', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 320 });
  // eslint-disable-next-line intent/no-unpaused-clock-in-ct -- skips recovery delays while allowing component transitions to settle
  await page.clock.install();
  await mount(Harness, { props: { scenario: 'startup' } });
  await page.clock.runFor(2600);
  await page.getByTestId('daemon-stopped-show-logs').click();
  await info.attach('short-window-recovery', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.locator('[data-testid="machine-rail-item"][data-machine-id="local"]').click();
  await expect(page.getByTestId('daemon-stopped-overlay')).toHaveCount(0);
});

test('without the rail, updating retains the window-wide recovery screen', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await mount(Harness, { props: { scenario: 'updating', rail: false } });
  await expect(page.getByTestId('daemon-updating-overlay')).toHaveAttribute('aria-modal', 'true');
  expect(
    await page.getByTestId('window-control').evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(false);
  await info.attach('rail-disabled-recovery', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
