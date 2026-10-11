import { test, expect } from '../lib/functional.mjs';
import {
  choose,
  control,
  expectJson,
  externalEffort,
  openEffort,
  picker,
  pressSequence,
  readout,
  toggle,
} from './effort-picker.helpers.mjs';

// Source Select defaults to looping. Every keyboard boundary is its own retry unit.
for (const { name, initial, keys, value } of [
  { name: 'rapid next then Enter', initial: null, keys: ['ArrowDown', 'Enter'], value: 'low' },
  { name: 'End then Enter', initial: null, keys: ['End', 'Enter'], value: 'high' },
  { name: 'Home then Enter', initial: 'high', keys: ['Home', 'Enter'], value: null },
  {
    name: 'lower edge wraps to Auto',
    initial: 'low',
    keys: ['End', 'ArrowDown', 'Enter'],
    value: null,
  },
  {
    name: 'upper edge wraps to final level',
    initial: null,
    keys: ['Home', 'ArrowUp', 'Enter'],
    value: 'high',
  },
]) {
  test(`effort keyboard: ${name}`, async ({ page }) => {
    const host = await openEffort(page);
    if (initial !== null) await externalEffort(host, initial);
    const trigger = picker(host);
    await trigger.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Auto', exact: true })).toBeVisible();
    await pressSequence(page, keys);
    await expectJson(host, 'Effort callbacks', [{ id: 1, effort: value, result: true }]);
    await expectJson(host, 'Effort persisted value', value);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

test('effort visibility: disabled blocks keyboard access and no levels hides the picker', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await toggle(host, 'Disable effort picker').click();
  await expect(trigger).toBeDisabled();
  await page.keyboard.press('Tab');
  await expect(trigger).not.toBeFocused();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expectJson(host, 'Effort callbacks', []);
  await toggle(host, 'Disable effort picker').click();
  await choose(page, trigger, 'High');
  await control(host, 'No levels').click();
  await expect(trigger).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await control(host, 'Standard levels').click();
  await expect(trigger).toHaveAccessibleName('Reasoning effort: High');
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: true }]);
  await choose(page, trigger, 'Auto');
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'high', result: true },
    { id: 2, effort: null, result: true },
  ]);
});

test('effort visibility: removing a selected level preserves its unavailable display until cleared', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await control(host, 'Extended levels').click();
  await choose(page, trigger, 'Extra high');
  await control(host, 'Standard levels').click();
  await expect(trigger).toHaveAccessibleName(/Extra high.*unavailable/);
  await expectJson(host, 'Effort persisted value', 'xhigh');
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'Extra high', exact: true })).toHaveCount(0);
  await pressSequence(page, ['Home', 'Enter']);
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'xhigh', result: true },
    { id: 2, effort: null, result: true },
  ]);
  await expectJson(host, 'Effort persisted value', null);
});

test('effort modal: first Escape closes only the picker and second restores the parent opener', async ({
  page,
}) => {
  const host = await openEffort(page);
  const opener = page.getByRole('button', { name: 'Open effort parent dialog', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Effort parent dialog', exact: true });
  const trigger = picker(dialog);
  await choose(page, trigger, 'High');
  await expect(dialog).toBeVisible();
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: true }]);
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'High', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(picker(host)).toHaveAccessibleName('Reasoning effort: High');
  await opener.press('Enter');
  await choose(page, picker(dialog), 'Auto');
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'high', result: true },
    { id: 2, effort: null, result: true },
  ]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('effort lifecycle: pending refusal after unmount cannot overwrite the remounted external value', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await toggle(host, 'Hold effort callback').click();
  await choose(page, trigger, 'High');
  await control(host, 'Unmount effort picker').click();
  await expect(trigger).toHaveCount(0);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await externalEffort(host, 'low');
  await control(host, 'Mount effort picker').click();
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Low');
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await control(host, 'Resolve next effort callback false').click();
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: false }]);
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Low');
  await expect(readout(host, 'Effort pending count')).toHaveText('0');
  await toggle(host, 'Hold effort callback').click();
  await choose(page, trigger, 'Medium');
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'high', result: false },
    { id: 2, effort: 'medium', result: true },
  ]);
});

test('effort provider values: explicit none and provider spelling stay distinct from Auto', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await control(host, 'Provider levels').click();
  const expected = [];
  for (const [effort, label] of [
    ['none', 'Off'],
    ['HIGH', 'High'],
    ['provider/Deep-Think', 'provider/Deep-Think'],
    [null, 'Auto'],
  ]) {
    await choose(page, trigger, label);
    expected.push({ id: expected.length + 1, effort, result: true });
    await expectJson(host, 'Effort callbacks', expected);
    await expectJson(host, 'Effort persisted value', effort);
    await expect(trigger).toHaveAccessibleName(`Reasoning effort: ${label}`);
  }
});

test('effort public Select: native arrows skip the disabled item in both directions', async ({
  page,
}) => {
  await openEffort(page);
  const host = page.locator('[data-functional-example="standalone-select-boundary"]');
  const trigger = host.getByRole('combobox', { name: 'Standalone Select', exact: true });
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'Beta unavailable', exact: true })).toBeDisabled();
  await pressSequence(page, ['ArrowDown', 'Enter']);
  await expectJson(host, 'Standalone Select value', 'gamma');
  await expectJson(host, 'Standalone Select callbacks', ['gamma']);
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'Gamma', exact: true })).toBeVisible();
  await pressSequence(page, ['ArrowUp', 'Enter']);
  await expectJson(host, 'Standalone Select value', 'alpha');
  await expectJson(host, 'Standalone Select callbacks', ['gamma', 'alpha']);
  await expect(trigger).toBeFocused();
});

test('effort public Select: controlled clear removes selection without inventing a callback', async ({
  page,
}) => {
  await openEffort(page);
  const host = page.locator('[data-functional-example="standalone-select-boundary"]');
  const trigger = host.getByRole('combobox', { name: 'Standalone Select', exact: true });
  await choose(page, trigger, 'Gamma');
  await expectJson(host, 'Standalone Select callbacks', ['gamma']);
  await control(host, 'Clear standalone Select').click();
  await expectJson(host, 'Standalone Select value', '');
  await expectJson(host, 'Standalone Select callbacks', ['gamma']);
  await expect(trigger).toHaveText('Choose a standalone value');
  await trigger.press('Enter');
  await expect(page.getByRole('option', { selected: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'Alpha', exact: true }).click();
  await expectJson(host, 'Standalone Select value', 'alpha');
  await expectJson(host, 'Standalone Select callbacks', ['gamma', 'alpha']);
  await expect(trigger).toBeFocused();
});
