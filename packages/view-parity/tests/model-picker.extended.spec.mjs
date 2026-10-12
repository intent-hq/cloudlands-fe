import {
  test,
  expect,
  capturePicker,
  control,
  expectJson,
  openEmptyModelPicker,
  openEmptyPanel,
  settingsAction,
  trigger,
} from '../lib/model-picker.mjs';

test('model picker empty: compact mode keeps its settings control reachable in a narrow viewport', async ({
  page,
  emptyModelWire,
}, info) => {
  const host = await openEmptyModelPicker(page, emptyModelWire, info);
  await openEmptyPanel(page, host);
  await capturePicker(page, trigger(host), 'before-compact', info);
  await page.keyboard.press('Escape');
  await control(host, 'compact').click();
  await openEmptyPanel(page, host);
  const reachable = await settingsAction(page).evaluate((button) => {
    const box = button.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return {
      insideViewport: x >= 0 && x < innerWidth && y >= 0 && y < innerHeight,
      hitIsControl: button.contains(document.elementFromPoint(x, y)),
    };
  });
  expect(reachable).toEqual({ insideViewport: true, hitIsControl: true });
  await capturePicker(page, trigger(host), 'after-compact', info);
  await settingsAction(page).click();
  await expectJson(host, 'settings-requests', 1);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();
});

test('model picker empty: optional default sentinel emits an empty string without a model tuple', async ({
  page,
  emptyModelWire,
}, info) => {
  const host = await openEmptyModelPicker(page, emptyModelWire, info);
  await control(host, 'show-default').click();
  await trigger(host).press('Enter');
  const option = page.getByRole('listbox').getByRole('option');
  await expect(option).toHaveCount(1);
  await option.click();
  // Source handleModelChange treats null -> Default as no actual model
  // change: no confirmation; handleModelSelect(undefined) calls onModelChange('').
  await expectJson(host, 'picks', [{ id: 1, model: '' }]);
  await expectJson(host, 'selection', '');
  await expectJson(host, 'last-tuple', null);
  await expectJson(host, 'confirmations', []);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger(host)).toBeFocused();
});
