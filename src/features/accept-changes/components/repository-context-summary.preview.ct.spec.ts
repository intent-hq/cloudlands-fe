import { test, expect } from '../../../test/ct-test';
import Preview from './repository-context-summary.preview.svelte';

test('repository details opens by keyboard, browses exact roots and collapses with focus retained', async ({
  mount,
}) => {
  const scene = await mount(Preview, { props: { scene: 'self-managed' } });
  const toggle = scene.getByRole('button', { name: 'Repository details', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.focus();
  await toggle.press('Enter');
  await expect(scene.getByText('feature/details', { exact: true })).toBeVisible();
  await scene.getByRole('button', { name: 'Tools root', exact: true }).click();
  await expect(scene.getByText('tools/maintenance', { exact: true })).toBeVisible();
  await expect(scene.getByText('feature/details', { exact: true })).toHaveCount(0);
  await scene.getByRole('button', { name: 'Missing root', exact: true }).click();
  await expect(scene.getByRole('status')).toBeVisible();
  await expect(scene.getByText('tools/maintenance', { exact: true })).toHaveCount(0);
  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await expect(scene.getByRole('button', { name: 'Read again' })).toHaveCount(0);
});

test('repository details clears retirement and equal-ID host replacement until an explicit read', async ({
  mount,
  page,
}) => {
  const scene = await mount(Preview, { props: { scene: 'self-managed', initiallyOpen: true } });
  await expect(scene.getByText('engineering/tools/editor', { exact: true })).toBeVisible();
  await scene.getByRole('button', { name: 'Retire read' }).click();
  await expect(scene.getByText('engineering/tools/editor', { exact: true })).toHaveCount(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(scene.getByRole('status')).toBeVisible();
  await scene.getByRole('button', { name: 'Read again' }).click();
  await expect(scene.getByText('engineering/tools/editor', { exact: true })).toBeVisible();
  await scene.getByRole('button', { name: 'Replace host' }).click();
  await expect(scene.getByText('engineering/tools/editor', { exact: true })).toHaveCount(0);
  await expect(scene.getByRole('status')).toBeVisible();
});

test('long canonical identity remains readable and controls operable at a narrow width', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 850 });
  const scene = await mount(Preview, { props: { scene: 'long', initiallyOpen: true } });
  const region = scene.getByRole('region', { name: 'Repository details' });
  await expect(
    region.getByText('https://forge.example:8443/platform/gitlab', { exact: true }),
  ).toBeVisible();
  const measurements = await region.evaluate((node) => ({
    width: node.clientWidth,
    scrollWidth: node.scrollWidth,
    clipped: Array.from(node.querySelectorAll('dd')).some(
      (value) => value.scrollWidth > value.clientWidth + 1,
    ),
  }));
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.width + 1);
  expect(measurements.clipped).toBe(false);
  const retry = region.getByRole('button', { name: 'Read again' });
  await retry.focus();
  await expect(retry).toBeFocused();
  await retry.press('Enter');
  await expect(
    region.getByText('https://forge.example:8443/platform/gitlab', { exact: true }),
  ).toBeVisible();
});

test('unavailable and inactive reads stay explicit and do not render a guessed target', async ({
  mount,
}) => {
  const scene = await mount(Preview, { props: { scene: 'unavailable', initiallyOpen: true } });
  await expect(scene.getByRole('status')).toBeVisible();
  await expect(scene.getByRole('button', { name: 'Read again' })).toBeEnabled();
  await expect(scene.getByText('engineering/tools/editor', { exact: true })).toHaveCount(0);
  await scene.getByRole('button', { name: 'Read again' }).click();
  await expect(scene.getByRole('button', { name: 'Read again' })).toBeEnabled();
  await expect(scene.getByRole('status')).toBeVisible();
});

test('repository choice saves exact input after confirmation, preserves cancel, resets explicitly and returns focus', async ({
  mount,
  page,
}) => {
  const scene = await mount(Preview, { props: { scene: 'selection-edit', initiallyOpen: true } });
  await scene.getByRole('button', { name: 'Edit review repository' }).click();
  const editor = scene.getByRole('region', { name: 'Review repository choice' });
  await expect(editor.getByText('No review choice has been saved.')).toBeVisible();
  const before = await editor.evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
    height: el.clientHeight,
  }));
  await test.info().attach('selection-before-save.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
  await editor.getByRole('combobox', { name: 'Review choice' }).click();
  await page.getByRole('option', { name: 'Named remote', exact: true }).click();
  const input = editor.getByRole('textbox', { name: 'Exact remote name' });
  await input.fill('review-origin');
  await editor.getByRole('button', { name: 'Save choice' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(input).toHaveValue('review-origin');
  await editor.getByRole('button', { name: 'Save choice' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(editor.getByText('The choice was applied.')).toBeVisible();
  await expect(editor.getByText('The change was committed to storage.')).toBeVisible();
  const after = await editor.evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
    height: el.clientHeight,
  }));
  await test.info().attach('selection-geometry.json', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  await test
    .info()
    .attach('selection-saved.png', { body: await scene.screenshot(), contentType: 'image/png' });
  await expect(editor.getByRole('button', { name: 'Save choice' })).toBeDisabled();
  await scene.getByRole('button', { name: 'Start a new edit' }).click();
  await editor.getByRole('button', { name: 'Reset choice' }).click();
  await expect(page.getByText('Reset review choice?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(editor.getByText('The choice was applied.')).toBeVisible();
  await editor.getByRole('button', { name: 'Close edit' }).click();
  await expect(scene.getByRole('button', { name: 'Edit review repository' })).toBeFocused();
});

test('historical choice requires an explicit option and the editor fits a narrow sidebar', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 280, height: 950 });
  const scene = await mount(Preview, {
    props: { scene: 'selection-history', initiallyOpen: true },
  });
  await scene.getByRole('button', { name: 'Edit review repository' }).click();
  const editor = scene.getByRole('region', { name: 'Review repository choice' });
  const choice = editor.getByRole('combobox', { name: 'Review choice' });
  await expect(choice).toContainText('Choose a review choice');
  await test.info().attach('selection-history-narrow.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
  await editor.getByRole('button', { name: 'Save choice' }).click();
  await expect(editor.getByText(/Choose Automatic or enter a valid remote name/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await choice.focus();
  await choice.press('Enter');
  await choice.press('Home');
  await choice.press('Enter');
  await editor.getByRole('button', { name: 'Save choice' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(editor.getByText('The choice was applied.')).toBeVisible();
  const bounds = await editor.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1);
});

test('unobserved result reconciles explicitly and retired history is hidden on terminal closure', async ({
  mount,
  page,
}) => {
  const scene = await mount(Preview, {
    props: { scene: 'selection-uncertain', initiallyOpen: true },
  });
  await scene.getByRole('button', { name: 'Edit review repository' }).click();
  const editor = scene.getByRole('region', { name: 'Review repository choice' });
  await editor.getByRole('button', { name: 'Save choice' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(editor.getByText(/The result was not observed/)).toBeVisible();
  await test.info().attach('selection-unobserved.png', {
    body: await scene.screenshot(),
    contentType: 'image/png',
  });
  await editor.getByRole('button', { name: 'Check result' }).click();
  await expect(editor.getByText('The choice was applied.')).toBeVisible();
  await scene.getByRole('button', { name: 'Retire edit' }).click();
  await expect(
    editor.getByText('This is an earlier edit, not the current repository state.'),
  ).toBeVisible();
  await expect(editor.getByText('The change was committed to storage.')).toBeVisible();
  await test
    .info()
    .attach('selection-retired.png', { body: await scene.screenshot(), contentType: 'image/png' });
  await scene.getByRole('button', { name: 'Close session' }).click();
  await expect(editor).toHaveCount(0);
});

test('changing roots and collapsing details ends the editor without reopening it', async ({
  mount,
}) => {
  const scene = await mount(Preview, { props: { scene: 'selection-edit', initiallyOpen: true } });
  await scene.getByRole('button', { name: 'Edit review repository' }).click();
  await expect(scene.getByRole('combobox', { name: 'Review choice' })).toBeVisible();
  await scene.getByRole('button', { name: 'Tools root' }).click();
  await expect(scene.getByRole('combobox', { name: 'Review choice' })).toHaveCount(0);
  await scene.getByRole('button', { name: 'Edit review repository' }).click();
  await expect(scene.getByRole('combobox', { name: 'Review choice' })).toBeVisible();
  const toggle = scene.getByRole('button', { name: 'Repository details', exact: true });
  await toggle.focus();
  await toggle.press('Enter');
  await expect(scene.getByRole('region', { name: 'Review repository choice' })).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.press('Enter');
  await expect(scene.getByRole('button', { name: 'Edit review repository' })).toBeVisible();
  await expect(scene.getByRole('combobox', { name: 'Review choice' })).toHaveCount(0);
});
