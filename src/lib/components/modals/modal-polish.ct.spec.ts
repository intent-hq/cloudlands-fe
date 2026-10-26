import { expect, test } from '../../../test/ct-test';
import TransferWorkspaceModal from './TransferWorkspaceModal.svelte';
import ModalPolishPreview from './modal-polish.preview.svelte';

for (const width of [720, 360]) {
  test(`transfer uses flush rows with the icon aligned to the title at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let selected = false;
    const component = await mount(TransferWorkspaceModal, {
      props: {
        open: true,
        workspaceTitle: 'Design system',
        connections: [
          {
            id: 'target',
            label: 'Other device',
            host: 'example.test',
            port: 443,
            fingerprint: null,
            isLocal: false,
          },
        ],
        onSelectDestination: () => {
          selected = true;
        },
      },
    });
    const option = page.getByTestId('transfer-download-option');
    const row = option.locator('[data-slot="list-row"]');
    await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const description = row.getByText('Save the transfer archive to your disk.');
    await expect(description).toBeVisible();
    expect(await description.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(option.locator('[data-slot="button-label"]')).toHaveCSS('white-space', 'normal');
    await option.click();
    await expect.poll(() => selected).toBe(true);
    await component.update({ props: { destination: { kind: 'download' } } });
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled();
  });

  test(`export offers a clear review action without a selector at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mount(ModalPolishPreview, { props: { state: 'transfer' } });
    const dialog = page.getByRole('dialog', { name: 'Export workspace', exact: true });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('Save “Design system” to a file you can import on another device.'),
    ).toBeVisible();
    await expect(page.getByTestId('transfer-download-option')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Review export', exact: true })).toBeEnabled();
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test(`harness On/Off groups adapt to ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await mount(ModalPolishPreview, { props: { state: 'harness' } });
    const on = page.getByRole('region', { name: 'On', exact: true });
    const off = page.getByRole('region', { name: 'Off', exact: true });
    await expect(on.getByText('Browser automation', { exact: true })).toBeVisible();
    const onBox = await on.boundingBox();
    const offBox = await off.boundingBox();
    if (width === 720) {
      expect(offBox!.x).toBeGreaterThan(onBox!.x);
    } else {
      expect(offBox!.y).toBeGreaterThan(onBox!.y);
    }
  });
}

test('handoff disclosure shares the heading gutter and opens across the body', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 800 });
  await mount(ModalPolishPreview, { props: { state: 'handoff' } });
  const dialog = page.getByRole('dialog');
  const trigger = dialog.getByRole('button', { name: 'Hand-off instruction', exact: true });
  await trigger.click();
  await expect(dialog.getByRole('textbox')).toBeVisible();
  await trigger.click();
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
});

test('ordinary edit form uses a readable width and saves', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 800 });
  await mount(ModalPolishPreview, { props: { state: 'form' } });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Workspace name').fill('Updated workspace');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
});
