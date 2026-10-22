import { test, expect } from '../../../test/ct-test';
import Preview from './native-review-attempt.preview.svelte';

test.describe.configure({ retries: 0 });

test('create confirmation preserves edits on cancel and separates actual reused review from publication', async ({
  mount,
  page,
}) => {
  const scene = await mount(Preview);
  const start = scene.getByRole('button', { name: 'Start a review' });
  await start.focus();
  await start.press('Enter');
  const branch = scene.getByRole('textbox', { name: 'Target branch' });
  await expect(branch).toHaveValue('');
  await expect(scene.getByRole('button', { name: 'Prepare merge request' })).toBeDisabled();
  await branch.focus();
  await branch.pressSequentially('release/example');
  await scene.getByRole('button', { name: 'Prepare merge request' }).click();
  await expect(branch).toBeDisabled();
  const title = scene.getByRole('textbox', { name: 'Title' });
  await expect(title).toHaveValue('Suggested request');
  await title.fill('My request');
  const before = await scene.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    height: el.clientHeight,
  }));
  await test.info().attach('native-review-before.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
  await scene.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(title).toHaveValue('My request');
  await scene.getByRole('button', { name: 'Change target branch' }).click();
  await expect(branch).toHaveValue('release/example');
  await branch.fill('release/revised');
  await scene.getByRole('button', { name: 'Prepare merge request' }).click();
  await expect(title).toHaveValue('My request');
  await scene.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(scene.getByText('Existing merge request reused')).toBeVisible();
  await expect(scene.getByRole('link', { name: 'Actual remote review title' })).toBeVisible();
  await expect(scene.getByText(/Local commits are ahead/)).toBeVisible();
  await expect(title).toHaveValue('My request');
  const after = await scene.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    height: el.clientHeight,
  }));
  expect(after.scroll).toBeLessThanOrEqual(after.width + 1);
  await test.info().attach('native-review-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  await test.info().attach('native-review-reused.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
  await scene.getByRole('button', { name: 'Close edit' }).click();
  await expect(start).toBeFocused();
  await expect(title).toHaveCount(0);
});

test('uncertain result is checked explicitly and terminal closure hides retained history', async ({
  mount,
  page,
}) => {
  const scene = await mount(Preview, { props: { scene: 'uncertain' } });
  await scene.getByRole('button', { name: 'Start a review' }).click();
  await scene.getByRole('textbox', { name: 'Target branch' }).fill('release/check');
  await scene.getByRole('button', { name: 'Prepare merge request' }).click();
  await expect(scene.getByRole('textbox', { name: 'Title' })).toHaveValue('Suggested request');
  await scene.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(scene.getByText(/The result is uncertain/).first()).toBeVisible();
  await expect(scene.getByRole('button', { name: 'Change target branch' })).toHaveCount(0);
  await expect(scene.getByRole('textbox', { name: 'Target branch' })).toHaveValue('release/check');
  await expect(scene.getByRole('textbox', { name: 'Target branch' })).toBeDisabled();
  await test.info().attach('native-review-uncertain.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
  await scene.getByRole('button', { name: 'Check result' }).click();
  await expect(scene.getByRole('region', { name: 'Original result check' })).toBeVisible();
  await expect(
    scene.getByRole('region', { name: 'Original execution' }).getByText(/The result is uncertain/),
  ).toBeVisible();
  await scene.getByRole('button', { name: 'Close original session' }).click();
  await expect(scene.getByRole('region', { name: 'Original execution' })).toHaveCount(0);
  await expect(scene.getByRole('region', { name: 'Original result check' })).toHaveCount(0);
});

test('Member metadata omissions stay unknown and the form fits a narrow view', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 300, height: 1100 });
  const scene = await mount(Preview, {
    props: { member: true, scene: 'created', baseRef: 'release/saved' },
  });
  await scene.getByRole('button', { name: 'Start a review' }).click();
  await expect(scene.getByRole('textbox', { name: 'Target branch' })).toHaveValue('release/saved');
  await scene.getByRole('button', { name: 'Prepare merge request' }).click();
  await expect(scene.getByRole('textbox', { name: 'Title' })).toHaveValue('Suggested request');
  await scene.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click();
  await expect(scene.getByText('Merge request created')).toBeVisible();
  await expect(scene.getByText('Unknown').first()).toBeVisible();
  const geometry = await scene.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    clipped: Array.from(el.querySelectorAll('dd')).some(
      (value) => value.scrollWidth > value.clientWidth + 1,
    ),
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.clipped).toBe(false);
  await test.info().attach('native-review-member-geometry.json', {
    body: JSON.stringify(geometry),
    contentType: 'application/json',
  });
  await test.info().attach('native-review-member.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
});
