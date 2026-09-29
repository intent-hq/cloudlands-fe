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
