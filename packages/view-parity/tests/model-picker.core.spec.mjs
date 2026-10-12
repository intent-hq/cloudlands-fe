import {
  test,
  expect,
  capturePicker,
  control,
  expectJson,
  observationSnapshot,
  openEmptyModelPicker,
  openEmptyPanel,
  settingsAction,
  trigger,
} from '../lib/model-picker.mjs';

// No real model tuples exist in the approved private service. Selection,
// confirmation races, agent-deferred writes and provider replacement remain
// UNVERIFIED; these tests must not be reported as full ModelPicker acceptance.
test('model picker empty: settings invokes the caller, closes and restores focus', async ({
  page,
  emptyModelWire,
}, info) => {
  const host = await openEmptyModelPicker(page, emptyModelWire, info);
  const url = page.url();
  await openEmptyPanel(page, host);
  await capturePicker(page, trigger(host), 'before-settings-callback', info);
  await settingsAction(page).click();
  await expectJson(host, 'settings-requests', 1);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();
  expect(page.url(), 'This consumer records settings intent; it does not navigate').toBe(url);
  await expectJson(host, 'picks', []);
  await expectJson(host, 'confirmations', []);
  await openEmptyPanel(page, host);
  await capturePicker(page, trigger(host), 'after-settings-callback', info);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();
});

test('model picker empty: keyboard and public ref respect a live lock and recover', async ({
  page,
  emptyModelWire,
}, info) => {
  const host = await openEmptyModelPicker(page, emptyModelWire, info);
  await openEmptyPanel(page, host);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();

  await control(host, 'open').click();
  await expect(settingsAction(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();

  await control(host, 'locked').click();
  await expect(trigger(host)).toBeDisabled();
  await control(host, 'open').click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeDisabled();
  await expectJson(host, 'picks', []);

  await control(host, 'locked').click();
  await expect(trigger(host)).toBeEnabled();
  await control(host, 'open').click();
  await expect(settingsAction(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();
  await expectJson(host, 'confirmations', []);
});

test('model picker empty: unmount releases its real observation and remount acquires a new one', async ({
  page,
  emptyModelWire,
}, info) => {
  const host = await openEmptyModelPicker(page, emptyModelWire, info);
  await expect.poll(async () => (await observationSnapshot(page)).observers.length).toBe(1);
  const before = await observationSnapshot(page);
  expect(before.observers[0].providerIds).toEqual([]);
  expect(before.observers[0].workspaceId).toBeUndefined();
  await openEmptyPanel(page, host);
  await control(host, 'mounted').click();
  await expectJson(host, 'mounted-state', false);
  await expect(host.getByTestId('model-picker-live-host').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect.poll(async () => (await observationSnapshot(page)).observers).toEqual([]);
  const unmounted = await observationSnapshot(page);

  await control(host, 'mounted').click();
  await expectJson(host, 'mounted-state', true);
  await expect.poll(async () => (await observationSnapshot(page)).observers.length).toBe(1);
  const remounted = await observationSnapshot(page);
  expect(remounted.observers[0].id).not.toBe(before.observers[0].id);
  expect(remounted.observers[0].providerIds).toEqual([]);
  await info.attach('model-picker-observation-lifetime.json', {
    body: JSON.stringify({ before, unmounted, remounted }, null, 2),
    contentType: 'application/json',
  });
  await openEmptyPanel(page, host);
  await page.keyboard.press('Escape');
  await expect(trigger(host)).toBeFocused();
  await expectJson(host, 'picks', []);
});
