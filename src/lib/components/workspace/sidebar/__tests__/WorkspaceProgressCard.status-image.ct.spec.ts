import { expect, test } from '../../../../../test/ct-test';
import WorkspaceProgressCardStatusImageHost from './mocks/WorkspaceProgressCardStatusImageHost.svelte';

// intent-hq/intent#6178: the status screenshot button kept the default control
// height, so the image overflowed it and covered the panels below.
const STATUS_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220" viewBox="0 0 600 220"><rect width="600" height="220" fill="#3b82f6"/></svg>`;

test.beforeEach(async ({ page }) => {
  await page.route('workspace-asset://**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: STATUS_IMAGE_SVG }),
  );
});

test('sizes the status image button to the image and keeps following content below it', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardStatusImageHost, {
    props: { statusImageAssetId: 'status-image-asset' },
  });
  const button = component.getByRole('button', { name: 'View workspace status screenshot' });
  const image = button.getByRole('img', { name: 'Workspace status screenshot' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(600);

  const buttonBox = (await button.boundingBox())!;
  const imageBox = (await image.boundingBox())!;
  expect(imageBox.height).toBeGreaterThan(100);
  expect(Math.abs(buttonBox.height - imageBox.height)).toBeLessThanOrEqual(1);
  expect(imageBox.y).toBeGreaterThanOrEqual(buttonBox.y - 1);
  expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(buttonBox.y + buttonBox.height + 1);

  const nextBox = (await component.getByTestId('next-sibling').boundingBox())!;
  expect(nextBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height - 0.5);

  await page.mouse.click(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('renders no status image button without a status image', async ({ mount }) => {
  const component = await mount(WorkspaceProgressCardStatusImageHost);
  await expect(component.getByText('Status image message')).toBeVisible();
  await expect(
    component.getByRole('button', { name: 'View workspace status screenshot' }),
  ).toHaveCount(0);
});
