import { expect, openExample, outputJson } from '../lib/functional.mjs';

// Private native interaction helpers. No page state writes or error exceptions.
export const readout = (host, name) => host.getByLabel(name, { exact: true });
export const control = (host, name) => host.getByRole('button', { name, exact: true });
export const toggle = (host, name) => host.getByRole('switch', { name, exact: true });
export const picker = (host) => host.getByTestId('effort-picker-trigger');

export async function openEffort(page) {
  await openExample(page, 'effort-picker', 'effort-picker-callback');
  return page.getByTestId('effort-exercise-host');
}

export async function externalEffort(host, value) {
  await host.getByRole('textbox', { name: 'External persisted effort', exact: true }).fill(value);
  await control(host, 'Apply external effort').click();
}

export async function expectJson(host, name, expected) {
  await expect.poll(() => outputJson(readout(host, name))).toEqual(expected);
}

export async function choose(page, trigger, label) {
  await trigger.press('Enter');
  await page.getByRole('option', { name: label, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

export async function pressSequence(page, keys) {
  // No waits/assertions between keys: expose delayed-focus selection races.
  for (const key of keys) await page.keyboard.press(key);
}

export async function capturePicker(page, trigger, name, info) {
  await page.evaluate(() => document.fonts.ready);
  const popup = page.getByRole('listbox');
  await expect(popup).toBeVisible();
  const geometry = {
    viewport: page.viewportSize(),
    trigger: await trigger.boundingBox(),
    popup: await popup.boundingBox(),
    options: await popup.getByRole('option').evaluateAll((options) =>
      options.map((option) => {
        const bounds = option.getBoundingClientRect();
        return {
          label: option.textContent,
          selected: option.getAttribute('aria-selected'),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      }),
    ),
  };
  await info.attach(`${name}-geometry.json`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await info.attach(`${name}.png`, {
    body: await page.screenshot({ animations: 'allow' }),
    contentType: 'image/png',
  });
  return geometry;
}
