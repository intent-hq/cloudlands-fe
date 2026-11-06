import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

for (const scenario of ['pr-status-list', 'board-pr-status'] as const) {
  test(`Home ${scenario} exposes PR state and preserves attention filtering`, async ({
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
      await expect(row(`home-${state}`).getByRole('img', { name })).toBeVisible();
      await expect(
        row(`home-${state}-running`).getByRole('img', {
          name: /Running/i,
        }),
      ).toBeVisible();
    }
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
    await expect(row('home-pr_ready-running')).toHaveCount(0);
    await expect(row('home-pr_open')).toHaveCount(0);
    await expect(row('home-pr_queued')).toHaveCount(0);
    await expect(row('home-pr-review')).toBeVisible();
    await expect(row('home-pr-question')).toBeVisible();
    await expect(row('home-pr-failed')).toBeVisible();
    await expect(row('home-pr-blocked')).toBeVisible();
  });
}

for (const [theme, width] of [
  ['light', 1440],
  ['dark', 820],
] as const) {
  test(`Home keeps running PR verification out of Needs you in ${theme} mode`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    const component = await mount(Preview, { props: { scenario: 'board-pr-status', height: 940 } });
    const row = (id: string) => component.locator(`[data-home-workspace="${id}"]`);
    const inColumn = (name: string, id: string) =>
      component.getByRole('region', { name, exact: true }).locator(`[data-home-workspace="${id}"]`);

    await expect(inColumn('Needs you', 'home-pr_ready')).toHaveCount(1);
    await page.evaluate(() => {
      window.__homeWorkspacePreview!.setTitle('home-pr_ready', 'Refine app dropdown styles');
      for (const id of [
        'home-pr-review',
        'home-pr-question',
        'home-pr-failed',
        'home-pr-blocked',
      ]) {
        window.__homeWorkspacePreview!.setFlags(id, {
          scriptsRunning: true,
          backgroundTasksRunning: true,
        });
      }
      window.__homeWorkspacePreview!.setFlags('home-pr_ready', { scriptsRunning: true });
    });
    await expect(inColumn('Running', 'home-pr_ready')).toHaveCount(1);
    await expect(row('home-pr_ready').getByRole('img')).toHaveAccessibleName(
      /^Running\. A command script/,
    );
    for (const id of ['home-pr-review', 'home-pr-question', 'home-pr-failed', 'home-pr-blocked']) {
      await expect(inColumn('Needs you', id)).toHaveCount(1);
    }
    await page.mouse.move(0, 0);
    await testInfo.attach('running-pr-verification', {
      body: await page.screenshot({ path: testInfo.outputPath(`running-pr-${theme}.png`) }),
      contentType: 'image/png',
    });

    await page.evaluate(() =>
      window.__homeWorkspacePreview!.setFlags('home-pr_ready', {
        scriptsRunning: false,
        backgroundTasksRunning: true,
      }),
    );
    await expect(inColumn('Running', 'home-pr_ready')).toHaveCount(1);
    await expect(row('home-pr_ready').getByRole('img')).toHaveAccessibleName(
      /^Running\. An agent's background task/,
    );

    await page.setViewportSize({ width: 1440, height: 1000 });
    await component.getByRole('button', { name: 'List view', exact: true }).click();
    const filters = component.getByRole('group', { name: 'Status', exact: true });
    await filters.getByRole('button', { name: /^Needs you/ }).click();
    await expect(row('home-pr_ready')).toHaveCount(0);
    await expect(row('home-pr_ready-running')).toHaveCount(0);
    for (const id of ['home-pr-review', 'home-pr-question', 'home-pr-failed', 'home-pr-blocked']) {
      await expect(row(id)).toBeVisible();
    }

    await page.evaluate(() =>
      window.__homeWorkspacePreview!.setFlags('home-pr_ready', {
        backgroundTasksRunning: false,
      }),
    );
    await expect(row('home-pr_ready')).toBeVisible();
    await expect(row('home-pr_ready').getByRole('img')).toHaveAccessibleName(/^PR mergeable\./i);
  });
}
