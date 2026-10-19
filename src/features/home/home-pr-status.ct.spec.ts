import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

for (const scenario of ['pr-status-list', 'board-pr-status'] as const) {
  test(`Home ${scenario} exposes PR state on hover and preserves attention filtering`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const component = await mount(Preview, { props: { scenario, height: 940 } });
    const row = (id: string) => component.locator(`[data-home-workspace="${id}"]`);
    for (const [state, name] of [
      ['pr_open', /PR open/i],
      ['pr_ready', /PR Mergeable/i],
      ['pr_queued', /PR queued/i],
    ] as const) {
      const status = row(`home-${state}`).getByRole('img', { name });
      await status.hover();
      await expect(page.getByRole('tooltip')).toContainText(name);
      await expect(page.getByRole('tooltip')).toContainText(/Waiting/i);
      await page.mouse.move(0, 0);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await expect(
        row(`home-${state}-running`).getByRole('img', {
          name: state === 'pr_ready' ? /PR Mergeable/i : /Running/i,
        }),
      ).toBeVisible();
    }
    const idle = row('home-pr-idle').getByRole('img', { name: /^Waiting/i });
    await idle.hover();
    await expect(page.getByRole('tooltip')).toContainText(/Waiting/i);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    for (const waiting of [false, undefined, true]) {
      await page.evaluate((value) => window.__homePrStatusPreview!.setWaiting(value), waiting);
      await expect(row('home-pr-idle').getByRole('img')).toHaveAccessibleName(
        waiting ? /^Waiting/i : /^Idle/i,
      );
      for (const id of [
        'home-pr_open',
        'home-pr_ready',
        'home-pr_queued',
        'home-pr-merged',
        'home-pr-complete',
      ]) {
        if (waiting) await expect(row(id).getByRole('img')).toHaveAccessibleName(/Waiting/i);
        else await expect(row(id).getByRole('img')).not.toHaveAccessibleName(/Waiting/i);
      }
      await expect(row('home-pr-unread').getByRole('img')).not.toHaveAccessibleName(/Waiting/i);
    }
    for (const [id, name] of [
      ['review', /Needs you/i],
      ['question', /Needs you/i],
      ['failed', /Failed/i],
      ['blocked', /Blocked/i],
      ['merged', /Done/i],
      ['complete', /Done/i],
    ] as const) {
      await expect(row(`home-pr-${id}`).getByRole('img', { name })).toBeVisible();
    }
    await component
      .getByRole('group', { name: 'Status', exact: true })
      .getByRole('button', { name: /^Needs you/ })
      .click();
    await expect(row('home-pr_ready')).toBeVisible();
    await expect(row('home-pr_ready-running')).toBeVisible();
    await expect(row('home-pr_open')).toHaveCount(0);
    await expect(row('home-pr_queued')).toHaveCount(0);
    await expect(row('home-pr-review')).toBeVisible();
    await expect(row('home-pr-question')).toBeVisible();
    await expect(row('home-pr-failed')).toBeVisible();
    await expect(row('home-pr-blocked')).toBeVisible();
  });
}
