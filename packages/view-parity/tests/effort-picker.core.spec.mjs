import { test, expect } from '../lib/functional.mjs';
import {
  capturePicker,
  choose,
  control,
  expectJson,
  externalEffort,
  openEffort,
  picker,
  readout,
  toggle,
} from './effort-picker.helpers.mjs';

// Source oracle: EffortPicker.svelte's embedded props and commit contract.
// These are real callback consumers, not evidence of agent/daemon persistence.
test('effort callback: ordered levels send exact values once and Auto sends null', async ({
  page,
}, info) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await trigger.press('Enter');
  await expect(page.getByRole('option')).toHaveText(['Auto', 'Low', 'Medium', 'High']);
  await expectJson(host, 'Effort callbacks', []);
  await capturePicker(page, trigger, 'before-selection', info);
  await page.getByRole('option', { name: 'Auto', exact: true }).click();
  await expectJson(host, 'Effort callbacks', []);

  const expected = [];
  for (const [effort, label] of [
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ]) {
    await choose(page, trigger, label);
    expected.push({ id: expected.length + 1, effort, result: true });
    await expectJson(host, 'Effort callbacks', expected);
    await expectJson(host, 'Effort persisted value', effort);
    await expect(trigger).toHaveAccessibleName(`Reasoning effort: ${label}`);
  }
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'High', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await capturePicker(page, trigger, 'after-selection', info);
  await page.getByRole('option', { name: 'High', exact: true }).click();
  await expectJson(host, 'Effort callbacks', expected);
  await choose(page, trigger, 'Auto');
  await expectJson(host, 'Effort callbacks', [...expected, { id: 4, effort: null, result: true }]);
  await expectJson(host, 'Effort persisted value', null);
});

test('effort callback: unsupported persisted value stays visible and Auto clears it', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await control(host, 'Apply external effort').click();
  await expect(trigger).toHaveAccessibleName(/legacy-ultra.*unavailable/);
  await expectJson(host, 'Effort callbacks', []);
  await trigger.press('Enter');
  await expect(page.getByRole('option')).toHaveText(['Auto', 'Low', 'Medium', 'High']);
  await expect(page.getByRole('option', { name: /legacy-ultra/ })).toHaveCount(0);
  await page.getByRole('option', { name: 'Auto', exact: true }).click();
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: null, result: true }]);
  await expectJson(host, 'Effort persisted value', null);
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Auto');
  await expect(trigger).toBeFocused();
});

test('effort callback: false completion rolls back the optimistic selection', async ({ page }) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await toggle(host, 'Hold effort callback').click();
  await choose(page, trigger, 'High');
  await expect(trigger).toHaveAccessibleName('Reasoning effort: High');
  await expectJson(host, 'Effort persisted value', null);
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: 'pending' }]);
  await control(host, 'Resolve next effort callback false').click();
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Auto');
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: false }]);
  await expectJson(host, 'Effort persisted value', null);
  await expect(readout(host, 'Effort pending count')).toHaveText('0');
});

test('effort callback: immediate false keeps the persisted value and permits a later choice', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await externalEffort(host, 'low');
  await toggle(host, 'Refuse effort callback immediately').click();
  await choose(page, trigger, 'High');
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: false }]);
  await expectJson(host, 'Effort persisted value', 'low');
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Low');
  await expect(readout(host, 'Effort pending count')).toHaveText('0');
  await toggle(host, 'Refuse effort callback immediately').click();
  await choose(page, trigger, 'High');
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'high', result: false },
    { id: 2, effort: 'high', result: true },
  ]);
  await expectJson(host, 'Effort persisted value', 'high');
});

test('effort callback: false completion restores the latest external value', async ({ page }) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await externalEffort(host, 'low');
  await toggle(host, 'Hold effort callback').click();
  await choose(page, trigger, 'High');
  await externalEffort(host, 'medium');
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Medium');
  await control(host, 'Resolve next effort callback false').click();
  await expectJson(host, 'Effort callbacks', [{ id: 1, effort: 'high', result: false }]);
  await expectJson(host, 'Effort persisted value', 'medium');
  await expect(trigger).toHaveAccessibleName('Reasoning effort: Medium');
  await trigger.press('Enter');
  await expect(page.getByRole('option', { name: 'Medium', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('effort callback: pending busy state retains focus and accepts another native choice', async ({
  page,
}) => {
  const host = await openEffort(page);
  const trigger = picker(host);
  await toggle(host, 'Hold effort callback').click();
  await choose(page, trigger, 'Low');
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await expect(trigger).toBeEnabled();
  await expect(trigger).toBeFocused();
  await choose(page, trigger, 'High');
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'low', result: 'pending' },
    { id: 2, effort: 'high', result: 'pending' },
  ]);
  await expect(readout(host, 'Effort pending count')).toHaveText('2');
  await control(host, 'Resolve next effort callback true').click();
  await expectJson(host, 'Effort persisted value', 'low');
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await control(host, 'Resolve next effort callback true').click();
  await expectJson(host, 'Effort callbacks', [
    { id: 1, effort: 'low', result: true },
    { id: 2, effort: 'high', result: true },
  ]);
  await expectJson(host, 'Effort persisted value', 'high');
  await expect(readout(host, 'Effort pending count')).toHaveText('0');
  await expect(trigger).not.toHaveAttribute('aria-busy', 'true');
  await expect(trigger).toHaveAccessibleName('Reasoning effort: High');
});
