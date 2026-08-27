import { expect, test } from '@playwright/experimental-ct-svelte';
import type { ConnectionRecord } from '$shared/types/connections';
import DeviceRow from '../DeviceRow.svelte';

const device: ConnectionRecord = {
  id: 'remote-1',
  label: 'Studio Mac',
  accent: 'indigo',
  host: '10.0.0.2',
  port: 5181,
  fingerprint: 'AA:BB',
  isLocal: false,
  status: 'not-open',
};

test('keeps edit fields and controls contained and wrapped at narrow width', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 760 });
  const component = await mount(DeviceRow, {
    props: {
      device,
      panelMode: 'edit',
      onOpenPanel: () => {},
      onClosePanel: () => {},
      onRequestRemove: () => {},
    },
  });
  const form = component.getByRole('form', { name: 'Edit Studio Mac' });
  const formBox = await form.boundingBox();
  expect(formBox).not.toBeNull();

  const controls = ['Remove', 'Test connection', 'Cancel', 'Update'].map((name) =>
    form.getByRole('button', { name }),
  );
  const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(formBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(formBox!.x + formBox!.width + 1);
  }
  expect(new Set(boxes.map((box) => Math.round(box!.y))).size).toBeGreaterThan(1);

  for (const name of ['Name', 'Hostname or IP', 'Port']) {
    const inputBox = await form.getByRole('textbox', { name, exact: true }).boundingBox();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(formBox!.x + formBox!.width + 1);
  }
});
