import { mkdir } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import Host from './MonitoredPrsRowGeometryHost.svelte';

// Paired review artifacts use the actual shared components and coherent identical
// facts. Widths exercise compact controls and the full-width details layout.
for (const width of [360, 720]) {
  for (const provider of ['github', 'gitlab'] as const) {
    for (const referenceState of [
      'pending',
      'passing',
      'failing',
      'unknown',
      'loading',
      'failed',
      'completed',
      'null',
      'restricted',
      'paused',
      'reconnect',
      'unresolved',
      'no-link',
      'wake',
      'wake-no-link',
    ]) {
      test(`${provider} ${referenceState} controls at ${width}`, async ({ mount, page }) => {
        await page.setViewportSize({ width, height: 520 });
        const component = await mount(Host, { props: { width, provider, referenceState } });
        await page.evaluate(() => document.fonts.ready);
        if (referenceState === 'loading' || referenceState === 'failed') {
          await expect(component.getByTestId('pr-monitors-snapshot-status')).toHaveAttribute(
            'data-snapshot-status',
            referenceState,
          );
        } else if (referenceState === 'completed') {
          await expect(component.getByTestId('monitored-pr-summary')).toHaveCount(0);
        } else if (referenceState.startsWith('wake')) {
          const chip = component.getByTestId('pr-monitor-wake-chip');
          await expect(chip).toBeVisible();
          if (referenceState === 'wake-no-link') await expect(chip).toBeDisabled();
          else await expect(chip).toBeEnabled();
        } else {
          const summary = component.getByTestId('monitored-pr-summary');
          await summary.focus();
          await page.keyboard.press('Enter');
          await expect(summary).toHaveAttribute('aria-expanded', 'true');
          const details = component.getByTestId('monitored-pr-details');
          await expect(details).toBeVisible();
          if (referenceState === 'null' || referenceState === 'restricted')
            await expect(details).not.toContainText('Ready to merge');
          const menu = component.getByTestId('monitored-pr-chip');
          await menu.focus();
          await page.keyboard.press('Enter');
          await expect(page.getByTestId('monitored-pr-cancel-item')).toBeVisible();
          if (referenceState === 'no-link' || referenceState === 'unresolved') {
            await expect(page.getByTestId('monitored-pr-open-in-app-item')).toHaveAttribute(
              'aria-disabled',
              'true',
            );
            await expect(page.getByTestId('monitored-pr-open-external-item')).toHaveAttribute(
              'aria-disabled',
              'true',
            );
          }
          // Floating placement can keep moving after visibility/animation checks pass.
          // Capture only after the actual geometry remains unchanged across frames.
          let previousBox = '';
          let stableSamples = 0;
          await expect
            .poll(
              async () => {
                const currentBox = JSON.stringify(
                  await page.getByTestId('monitored-pr-menu').boundingBox(),
                );
                stableSamples = currentBox === previousBox ? stableSamples + 1 : 0;
                previousBox = currentBox;
                return stableSamples;
              },
              { intervals: [50] },
            )
            .toBeGreaterThanOrEqual(3);
          const box = await page.getByTestId('monitored-pr-menu').boundingBox();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          if (referenceState === 'pending' || referenceState === 'no-link') {
            await mkdir('.demo-artifacts/qualified-monitor', { recursive: true });
            await page.screenshot({
              animations: 'disabled',
              path: `.demo-artifacts/qualified-monitor/${provider}-${referenceState}-menu-${width}.png`,
            });
          }
          await page.keyboard.press('Escape');
          await expect(menu).toBeFocused();
          await expect(page.getByTestId('monitored-pr-menu')).toHaveCount(0);
        }
        expect(await component.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
          true,
        );
        await mkdir('.demo-artifacts/qualified-monitor', { recursive: true });
        await page.screenshot({
          animations: 'disabled',
          path: `.demo-artifacts/qualified-monitor/${provider}-${referenceState}-${width}.png`,
        });
      });
    }
    for (const surface of ['sidebar', 'card'] as const) {
      test(`${provider} ${surface} completed and no-link rows at ${width}`, async ({
        mount,
        page,
      }) => {
        await page.setViewportSize({ width, height: 650 });
        const component = await mount(Host, {
          props: { width, provider, surface, referenceState: 'completed' },
        });
        await page.evaluate(() => document.fonts.ready);
        const row =
          surface === 'sidebar'
            ? component.locator('[data-sidebar-pr-link]')
            : component.locator('[data-workspace-hover-card-pr-row]');
        await expect(row).toBeVisible();
        await expect(row).toHaveAttribute('data-pr-status', 'merged');
        await mkdir('.demo-artifacts/qualified-monitor', { recursive: true });
        await page.screenshot({
          animations: 'disabled',
          path: `.demo-artifacts/qualified-monitor/${provider}-${surface}-completed-${width}.png`,
        });
        await component.update({ props: { width, provider, surface, referenceState: 'no-link' } });
        if (surface === 'sidebar') {
          const trigger = component.locator('[data-sidebar-pr-trigger]');
          await trigger.focus();
          await page.keyboard.press('Enter');
          await expect(
            page.getByRole('menuitem').filter({ hasText: 'Align expanded' }),
          ).toHaveAttribute('aria-disabled', 'true');
          await page.keyboard.press('Escape');
          await expect(trigger).toBeFocused();
        } else {
          await expect(component.locator('button[data-workspace-card-pr-item]')).toHaveCount(0);
          await expect(component.locator('button[data-workspace-hover-card-pr-row]')).toHaveCount(
            0,
          );
        }
        expect(await component.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
          true,
        );
        await page.screenshot({
          animations: 'disabled',
          path: `.demo-artifacts/qualified-monitor/${provider}-${surface}-no-link-${width}.png`,
        });
      });
    }
  }
}

for (const width of [360, 720]) {
  test(`mixed same-number reviews keep independent sidebar controls at ${width}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 520 });
    const component = await mount(Host, {
      props: { width, provider: 'gitlab', surface: 'sidebar', referenceState: 'mixed' },
    });
    await expect(component.locator('[data-sidebar-pr-link]')).toHaveCount(3);
    const trigger = component.locator('[data-sidebar-pr-trigger]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const items = page.getByRole('menuitem').filter({ hasText: 'Align expanded' });
    await expect(items).toHaveCount(3);
    const identities = await items.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-pr-identity')),
    );
    expect(new Set(identities).size).toBe(3);
    const labels = await items.evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute('aria-label'),
        title: node.getAttribute('title'),
        url: node.getAttribute('data-sidebar-pr-url'),
      })),
    );
    expect(new Set(labels.map((row) => row.label)).size).toBe(3);
    expect(new Set(labels.map((row) => row.title)).size).toBe(3);
    expect(labels.some((row) => row.label?.includes('forge.example/gitlab'))).toBe(true);
    expect(labels.some((row) => row.label?.includes('second.example/install'))).toBe(true);
    expect(labels.map((row) => row.url).sort()).toEqual([
      '',
      'https://forge.example/gitlab/intent-hq/cloudlands-fe/-/merge_requests/2105',
      'https://github.com/intent-hq/cloudlands-fe/pull/2105',
    ]);

    await expect(
      items.filter({ has: page.locator('[data-sidebar-pr-state]', { hasText: 'Open' }) }),
    ).toHaveCount(3);
    await expect(page.locator('[role="menuitem"][aria-disabled="true"]')).toHaveCount(1);
    await mkdir('.demo-artifacts/qualified-monitor', { recursive: true });
    await page.screenshot({
      animations: 'disabled',
      path: `.demo-artifacts/qualified-monitor/mixed-sidebar-menu-${width}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  });
}

for (const width of [360, 720]) {
  for (const surface of ['chat', 'card'] as const) {
    test(`mixed instance ${surface} labels at ${width}`, async ({ mount, page }) => {
      await page.setViewportSize({ width, height: 650 });
      const component = await mount(Host, {
        props: { width, provider: 'gitlab', surface, referenceState: 'mixed' },
      });
      const controls =
        surface === 'chat'
          ? component.getByTestId('monitored-pr-summary')
          : component.locator('[data-workspace-hover-card-pr-row]');
      await expect(controls).toHaveCount(3);
      const labels = await controls.evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            node.getAttribute('aria-label') ??
            node.closest('[role="listitem"]')?.getAttribute('aria-label') ??
            node.textContent,
        ),
      );
      expect(new Set(labels).size).toBe(3);
      expect(labels.some((label) => label?.includes('forge.example/gitlab'))).toBe(true);
      expect(labels.some((label) => label?.includes('second.example/install'))).toBe(true);
      if (surface === 'card')
        await expect(component.locator('button[data-workspace-hover-card-pr-row]')).toHaveCount(2);
      await mkdir('.demo-artifacts/qualified-monitor', { recursive: true });
      await page.screenshot({
        animations: 'disabled',
        path: `.demo-artifacts/qualified-monitor/mixed-${surface}-${width}.png`,
      });
    });
  }
}
