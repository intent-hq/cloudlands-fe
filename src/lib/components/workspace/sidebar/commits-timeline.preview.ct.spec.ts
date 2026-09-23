import { expect, test } from '../../../../test/ct-test';
import CommitsTimelinePreview from './commits-timeline.preview.svelte';

test('keeps the boundary label and divider disjoint on hover and keyboard focus', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(CommitsTimelinePreview, {
    hooksConfig: { geometrySnapshot: { scene: 'commits-timeline', state: 'narrow' } },
  });
  const boundary = component.getByRole('button', { name: 'Workspace start' });
  await boundary.hover();
  const label = boundary.locator('[data-commit-boundary-label]');
  const divider = boundary.locator('[data-commit-boundary-divider]');
  const labelBox = (await label.boundingBox())!;
  const dividerBox = (await divider.boundingBox())!;
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(dividerBox.x);
  const boundaryBox = (await boundary.boundingBox())!;
  expect(labelBox.y).toBeGreaterThanOrEqual(boundaryBox.y);
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(boundaryBox.y + boundaryBox.height);
  expect(
    await component.evaluate((node) => node.scrollWidth - node.clientWidth),
  ).toBeLessThanOrEqual(1);

  await page.mouse.move(0, 0);
  await boundary.focus();
  await expect(boundary).toBeFocused();
  await expect(label).toHaveCSS('opacity', '1');
  await expect(boundary).toHaveAttribute('aria-expanded', 'true');
  await boundary.press('Enter');
  await expect(boundary).toHaveAttribute('aria-expanded', 'false');
  await expect(
    component.getByRole('button', { name: /Previous commit with a long title/ }),
  ).toHaveCount(0);
});

test('keeps a loading boundary disabled without shifting the label outside its surface', async ({
  mount,
}) => {
  const component = await mount(CommitsTimelinePreview, {
    hooksConfig: { geometrySnapshot: { scene: 'commits-timeline', state: 'loading' } },
  });
  const boundary = component.getByRole('button', { name: 'Workspace start' });
  await expect(boundary).toBeDisabled();
  await expect(boundary).toHaveAttribute('aria-busy', 'true');
  const boundaryBox = (await boundary.boundingBox())!;
  const labelBox = (await boundary.locator('[data-commit-boundary-label]').boundingBox())!;
  expect(labelBox.x).toBeGreaterThanOrEqual(boundaryBox.x);
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(boundaryBox.x + boundaryBox.width);
});
