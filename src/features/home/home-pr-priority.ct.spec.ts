import { expect, test } from '../../test/ct-test';
import { PullRequestStatus, type PullRequestInfo } from '$shared/types';
import Preview from './home.preview.svelte';

const pulls: PullRequestInfo[] = [
  {
    id: 'merged',
    number: 6693,
    url: 'https://github.com/intent-hq/intent/pull/6693',
    title: 'Bounded note viewing',
    status: PullRequestStatus.Merged,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  },
  {
    id: 'open',
    number: 3239,
    url: 'https://github.com/intent-hq/cloudlands-fe/pull/3239',
    title: 'Settle queued image preview',
    status: PullRequestStatus.Open,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  },
];

for (const scenario of ['populated', 'board'] as const) {
  test(`Home ${scenario} selects unfinished PRs and updates their tooltip and badge`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const component = await mount(Preview, { props: { scenario } });
    await page.evaluate(
      (value) => window.__homeWorkspacePreview!.setPullRequests('home-review', value, 12),
      pulls,
    );
    const row = component.locator('[data-home-workspace="home-review"]');
    const badge = row.locator('[data-home-workspace-pr-badge]');
    await expect(badge).toContainText('Open');
    await expect(badge).toContainText('#3239');
    if (scenario === 'populated') await expect(row.getByText('+11', { exact: true })).toBeVisible();
    await badge.hover();
    await expect(page.getByRole('tooltip')).toContainText(
      'Open · #3239 · Settle queued image preview',
    );
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toBeHidden();
    await testInfo.attach(`home-pr-priority-${scenario}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    const withDraft = [
      ...pulls,
      {
        ...pulls[1]!,
        id: 'draft',
        number: 3261,
        url: 'https://github.com/intent-hq/cloudlands-fe/pull/3261',
        title: 'Composer draft lifecycle',
        isDraft: true,
      },
    ];
    await page.evaluate(
      (value) => window.__homeWorkspacePreview!.setPullRequests('home-review', value, 12),
      withDraft,
    );
    await expect(badge).toContainText('Draft');
    await expect(badge).toContainText('#3261');

    // A merge-queued PR outranks drafts and more recently updated open PRs.
    const withQueued = [
      ...withDraft,
      {
        ...pulls[1]!,
        id: 'queued',
        number: 2733,
        url: 'https://github.com/intent-hq/intentd/pull/2733',
        title: 'Route browser.exec to the newest connection',
        updatedAt: '2026-09-30T00:00:00Z',
        isInMergeQueue: true,
      },
    ];
    await page.evaluate(
      (value) => window.__homeWorkspacePreview!.setPullRequests('home-review', value, 12),
      withQueued,
    );
    await expect(badge).toContainText('Queued');
    await expect(badge).toContainText('#2733');

    await page.evaluate(
      (value) => window.__homeWorkspacePreview!.setPullRequests('home-review', value, 12),
      withQueued.map((pr) => ({
        ...pr,
        status: PullRequestStatus.Merged,
        isDraft: false,
        isInMergeQueue: false,
      })),
    );
    await expect(badge).toContainText('Merged');
    await expect(badge).toContainText('#6693');
  });
}
