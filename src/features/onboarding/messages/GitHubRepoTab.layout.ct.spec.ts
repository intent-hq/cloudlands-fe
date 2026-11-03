import { expect, test } from '../../../test/ct-test';
import Harness from './github-repo-tab-harness.svelte';

// 1x1 transparent PNG so owner avatars render without network access.
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const repoLabel = (name: string) => new RegExp(`^octo / ${name}$`);

const repos = ['alpha', 'beta', 'gamma'].map((name) => ({
  id: `octo/${name}`,
  owner: 'octo',
  name,
}));

// Regression: rows had a fixed control height shorter than the avatar plus
// row padding, so each row's avatar and name spilled below its own box. The
// selection highlight then sat above the content it was meant to mark, and
// the overflow reached into the next row.
test('each repo row contains its avatar and name, so the highlight covers them', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await page.route('https://github.com/*.png*', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }),
  );
  const picked: string[] = [];
  await mount(Harness, {
    props: {
      repos,
      onGithubUrlChange: (url: string) => picked.push(url),
    },
  });

  const options = page.getByRole('option');
  await expect(options).toHaveCount(repos.length);
  await options.nth(1).getByText(repoLabel('beta')).click();
  await expect(page.getByRole('option', { selected: true })).toContainText('beta');
  await expect.poll(() => picked.at(-1)).toBe('https://github.com/octo/beta');

  for (const [index, repo] of repos.entries()) {
    const option = options.nth(index);
    const row = (await option.boundingBox())!;
    const avatarImage = option.locator('img');
    await expect(avatarImage).toBeVisible();
    const avatar = (await avatarImage.boundingBox())!;
    const label = (await option.getByText(repoLabel(repo.name)).boundingBox())!;
    for (const content of [avatar, label]) {
      expect(content.y).toBeGreaterThanOrEqual(row.y);
      expect(content.y + content.height).toBeLessThanOrEqual(row.y + row.height);
    }
  }

  await options.nth(2).getByText(repoLabel('gamma')).click();
  await expect.poll(() => picked.at(-1)).toBe('https://github.com/octo/gamma');
});
