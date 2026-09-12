import { test, expect } from '@playwright/experimental-ct-svelte';
import ArtifactPreview from './visual-artifact.preview.svelte';

test('board dragging moves a card and keyboard movement preserves its draft position', async ({
  mount,
  page,
}) => {
  const component = await mount(ArtifactPreview, { props: { kind: 'board' } });
  const card = component.getByRole('button', { name: /^A calmer first impression/ });
  const before = await card.boundingBox();
  if (!before) throw new Error('Card has no layout');
  await page.mouse.move(before.x + 30, before.y + 30);
  await page.mouse.down();
  await page.mouse.move(before.x + 90, before.y + 70);
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(before.x + 60, 0);
  await card.focus();
  await card.press('Shift+ArrowRight');
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(before.x + 70, 0);
  await card.press('Delete');
  await expect(card).toHaveCount(0);
});

test('image rectangle stays over the actual image and supports a saved annotation', async ({
  mount,
  page,
}) => {
  const component = await mount(ArtifactPreview, { props: { kind: 'image' } });
  const image = component.getByRole('button', { name: 'Select image region' });
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('Image has no layout');
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.5);
  await page.mouse.up();
  await component.getByRole('textbox').fill('Adjust this area');
  await component.getByRole('button', { name: 'Add annotation' }).click();
  await component.getByRole('button', { name: 'Adjust this area' }).click();
  const region = component.locator('.artifact-region:not(.artifact-saved-region)');
  await expect
    .poll(async () => (await region.boundingBox())?.width)
    .toBeCloseTo(bounds.width * 0.4, 0);
  await expect
    .poll(async () => (await region.boundingBox())?.height)
    .toBeCloseTo(bounds.height * 0.3, 0);
});

test('preview cannot access the parent and explicitly captured state survives reset', async ({
  mount,
  page,
}) => {
  const component = await mount(ArtifactPreview, { props: { kind: 'preview' } });
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: 'Try this direction' }).click();
  await component.getByRole('button', { name: 'Capture state' }).click();
  await component.getByRole('button', { name: 'Reset preview' }).click();
  await expect(frame.getByRole('button', { name: 'Try this direction' })).toBeVisible();
  const result = await frame.locator('body').evaluate(() => {
    let parentBlocked = false;
    try {
      void window.parent.document.body;
    } catch {
      parentBlocked = true;
    }
    const bridge = (window as unknown as { intentArtifact: { getState(): unknown } })
      .intentArtifact;
    return { parentBlocked, state: bridge.getState() };
  });
  expect(result).toEqual({ parentBlocked: true, state: { liked: true } });
});
