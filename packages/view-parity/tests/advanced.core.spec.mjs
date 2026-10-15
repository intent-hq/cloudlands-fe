import {
  test,
  expect,
  openFixture,
  openExample,
  openPreview,
  outputJson,
} from '../lib/functional.mjs';

test('questions: selection advances and controlled answers select the final question', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'ask-user-questions', 'controlled');
  await fixture.getByRole('radio', { name: /^Quality/ }).click();
  await expect(fixture.getByRole('radiogroup', { name: 'Who is this for?' })).toBeVisible();
  await fixture.getByRole('radio', { name: 'My team', exact: true }).click();
  await expect(fixture.getByRole('radio', { name: 'My team', exact: true })).toBeChecked();
  await expect(fixture.getByRole('radio', { name: 'Customers', exact: true })).not.toBeChecked();
});

test('questions: invalid free text shows an error and correction clears it', async ({ page }) => {
  const fixture = await openFixture(page, 'ask-user-questions', 'free-text-validation');
  const field = fixture.getByRole('textbox', { name: 'Name this project' });
  await field.fill('ab');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(fixture.getByRole('alert')).toBeVisible();
  await field.fill('Browser coverage');
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  await expect(fixture.getByRole('alert')).toBeHidden();
});

test('questions: arrow focus and Space toggle independent multi-select answers', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'ask-user-questions', 'multi-select');
  const speed = fixture.getByRole('checkbox', { name: /^Speed/ });
  const quality = fixture.getByRole('checkbox', { name: /^Quality/ });
  await speed.focus();
  await page.keyboard.press('Space');
  await expect(speed).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(quality).toBeFocused();
  await expect(quality).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(quality).toBeChecked();
  await expect(speed).toBeChecked();
  await page.keyboard.press('Space');
  await expect(quality).not.toBeChecked();
});

test('composer: Shift Enter retains multiline draft and Enter delivers trimmed text', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'message-composer', 'send-handler');
  const field = fixture.getByRole('textbox');
  await field.fill('  First line');
  await field.press('Shift+Enter');
  await field.pressSequentially('Second line  ');
  await expect(field).toHaveValue('  First line\nSecond line  ');
  await field.press('Enter');
  await expect(fixture.locator('[data-catalog-renderer-fixture] > output')).toHaveText(
    'Sent: First line\nSecond line',
  );
  await expect(field).toHaveValue('');
  await expect(fixture.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
});

test('composer: suggestion keyboard choice fills the draft without sending it', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'message-composer', 'suggestions');
  const field = fixture.getByRole('textbox');
  await field.focus();
  await field.press('ArrowDown');
  await field.press('ArrowDown');
  await field.press('Enter');
  await expect(field).toHaveValue('Draft a concise release note');
  await field.fill('');
  await field.press('Tab');
  await expect(field).toHaveValue('Summarize the current workspace');
});

test('composer: streaming queues the draft and stopping drains the queued request', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'message-composer', 'playground');
  await fixture.getByRole('button', { name: 'Toggle streaming', exact: true }).click();
  const field = fixture.getByRole('textbox');
  await field.fill('First queued request');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await expect(
    fixture.getByRole('button', { name: 'First queued request', exact: true }),
  ).toBeVisible();
  await fixture.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(fixture.locator('[data-catalog-renderer-fixture] > output')).toHaveText(
    'Sent: First queued request',
  );
  await expect(
    fixture.getByRole('button', { name: 'First queued request', exact: true }),
  ).toHaveCount(0);
  await fixture.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(fixture.locator('[data-catalog-renderer-fixture] > output')).toHaveText(
    'Stopped response',
  );
});

test('picker: filter and Enter commit the selected option then restore the label', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'combobox', 'combobox-state-matrix');
  const input = fixture.getByRole('combobox', { name: 'Catalog combobox', exact: true });
  await input.click();
  await input.fill('Ada');
  const listboxId = await input.getAttribute('aria-controls');
  await input.press('Enter');
  await expect
    .poll(() => outputJson(fixture.getByLabel('Combobox value', { exact: true })))
    .toBe('ada');
  await expect(input).toHaveValue('Ada Lovelace');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`[id="${listboxId}"]`)).toHaveCount(0);
  await expect(input).toBeFocused();
});

test('picker: multi-select toggles one option while preserving the other selection', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'combobox', 'combobox-state-matrix');
  const input = fixture.getByRole('combobox', {
    name: 'Multi-select catalog combobox',
    exact: true,
  });
  await input.click();
  const listboxId = await input.getAttribute('aria-controls');
  const listbox = page.locator(`[id="${listboxId}"]`);
  await listbox.getByRole('option', { name: 'Ada Lovelace', exact: true }).click();
  await expect
    .poll(() => outputJson(fixture.getByLabel('Multi-select combobox value', { exact: true })))
    .toEqual(['grace']);
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await input.press('Escape');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
});

test('picker: neighbouring inputs remain accessible and Tab dismisses the popup', async ({
  page,
}) => {
  const fixture = await openFixture(page, 'combobox', 'combobox-state-matrix');
  const input = fixture.getByRole('combobox', { name: 'Catalog combobox', exact: true });
  const neighbour = fixture.getByRole('combobox', {
    name: 'Multi-select catalog combobox',
    exact: true,
  });
  await input.click();
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(neighbour).toBeVisible();
  await input.press('Tab');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(input).not.toBeFocused();
  await expect(neighbour).toBeVisible();
});

test('select value: placeholder and keyboard-selected display label remain visible', async ({
  page,
}) => {
  const fields = await openFixture(page, 'fields', 'field-state-matrix');
  await expect(
    fields.locator('[data-field-preview="select-empty-placeholder"]').getByRole('combobox'),
  ).toHaveText('Choose an option');

  const fixture = await openPreview(page, 'select-focus', 'inline');
  const trigger = fixture.getByRole('combobox', { name: 'Choose fruit', exact: true });
  await expect(trigger).toHaveText('Apple');
  await trigger.focus();
  await trigger.press('ArrowDown');
  const apple = page.getByRole('option', { name: 'Apple', exact: true });
  await expect(apple).toBeVisible();
  await page.keyboard.press('ArrowDown');
  const banana = page.getByRole('option', { name: 'Banana', exact: true });
  await page.keyboard.press('Enter');
  await expect(fixture.getByTestId('select-value')).toHaveText('banana');
  await expect(trigger).toHaveText('Banana');
  await expect(trigger).toBeFocused();
  await expect(banana).toHaveCount(0);
});

test('select wrapper: public ID locates the popup container in portalled and inline modes', async ({
  page,
}) => {
  const example = await openExample(page, 'select', 'select-wrapper');
  for (const portal of [true, false]) {
    if (!portal) await example.getByRole('switch', { name: 'Portal select popup' }).click();
    const trigger = example.getByRole('combobox', { name: 'Wrapper lookup select' });
    await trigger.click();
    await expect(example.getByLabel('Select wrapper lookup', { exact: true })).toHaveText(
      'contains content',
    );
    const wrapperId = await example.getByLabel('Select wrapper ID', { exact: true }).textContent();
    const wrapper = page.locator(`[id="${wrapperId}"]`);
    await expect(wrapper.getByRole('option', { name: 'Banana', exact: true })).toBeVisible();
    await wrapper.getByRole('option', { name: 'Banana', exact: true }).click();
    await expect(example.getByLabel('Wrapper select value', { exact: true })).toHaveText('banana');
    await expect(trigger).toBeFocused();
  }
});

test('sidebar: persistent toggle writes its cookie while an isolated toggle leaves it unchanged', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  const persistent = await openExample(page, 'sidebar', 'sidebar-persistent');
  const cookies = async () =>
    (await context.cookies(page.url())).filter((cookie) => cookie.name === 'sidebar:state');
  expect(await cookies()).toEqual([]);
  await persistent.getByRole('button', { name: 'Toggle persistent sidebar' }).click();
  await expect(persistent.getByLabel('Persistent sidebar open')).toHaveText('false');
  await expect
    .poll(async () => (await cookies()).map(({ value, path }) => ({ value, path })))
    .toEqual([{ value: 'false', path: '/' }]);
  await persistent.getByRole('button', { name: 'Toggle persistent sidebar' }).click();
  await expect.poll(async () => (await cookies()).map(({ value }) => value)).toEqual(['true']);
  const saved = await cookies();
  const isolated = page.locator('[data-functional-example="sidebar-isolated"]');
  await isolated.getByRole('button', { name: 'Toggle isolated sidebar' }).click();
  await expect(isolated.getByLabel('Isolated sidebar open')).toHaveText('false');
  expect(await cookies()).toEqual(saved);
});

test('editable name: Enter saves once and Escape discards a later edit', async ({ page }) => {
  const example = await openExample(page, 'editable-name', 'editable-name');
  await example.getByRole('button', { name: 'Workspace name', exact: true }).click();
  const field = example.getByRole('textbox');
  await expect(field).toBeFocused();
  await field.fill('  Revised workspace  ');
  await field.press('Enter');
  await expect(example.getByLabel('Saved editable name')).toHaveText('Revised workspace');
  await expect(example.getByLabel('Name save count')).toHaveText('1');
  await example.getByRole('button', { name: 'Revised workspace', exact: true }).click();
  await field.fill('Discard this');
  await field.press('Escape');
  await expect(example.getByLabel('Saved editable name')).toHaveText('Revised workspace');
  await expect(example.getByLabel('Name save count')).toHaveText('1');
});

test('portal: content remains interactive in its target and unmounts with its owner', async ({
  page,
}) => {
  const example = await openExample(page, 'portal', 'portal');
  const target = example.getByTestId('widget-portal-target');
  await target.getByRole('button', { name: 'Portal action' }).click();
  await expect(example.getByLabel('Portal actions')).toHaveText('1');
  await example.getByRole('button', { name: 'Toggle portal content' }).click();
  await expect(target.getByRole('button')).toHaveCount(0);
  await example.getByRole('button', { name: 'Toggle portal content' }).click();
  await target.getByRole('button', { name: 'Portal action' }).click();
  await expect(example.getByLabel('Portal actions')).toHaveText('2');
});

test('rich tooltip: keyboard focus opens help and Escape preserves the control description', async ({
  page,
}) => {
  const example = await openExample(page, 'tooltip-rich', 'tooltip-forwarding');
  const control = example.getByRole('button', { name: 'Rich tooltip control', exact: true });
  await control.focus();
  await expect(example.getByLabel('Rich tooltip open', { exact: true })).toHaveText('true');
  await expect(page.getByRole('button', { name: 'Tooltip action', exact: true })).toBeVisible();
  await control.press('Escape');
  await expect(example.getByLabel('Rich tooltip open', { exact: true })).toHaveText('false');
  await expect(control).toBeFocused();
  await expect(control).toHaveAccessibleDescription(
    'The original control description remains available.',
  );
  await control.press('Space');
  await expect(example.getByLabel('Rich tooltip pressed', { exact: true })).toHaveText('true');
  await expect(example.getByLabel('Rich tooltip clicks', { exact: true })).toHaveText('1');
});

test('catalog navigation: arrows wrap, Home and End move focus, and Enter changes the active page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 900 });
  await openFixture(page, 'switch', 'switch-state-matrix');
  const navigation = page.getByRole('navigation').first();
  const selected = navigation.locator('a[aria-current="page"]');
  const menu = selected.locator('xpath=ancestor::ul[1]');
  const first = menu.getByRole('link').first();
  const last = menu.getByRole('link').last();
  const destination = await last.getAttribute('href');
  await expect(selected).toHaveAttribute('href', '/sandbox/switch');
  await selected.focus();
  await page.keyboard.press('ArrowDown');
  await expect(navigation.locator('a[href="/sandbox/table"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(last).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(first).toBeFocused();
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
  await expect(selected).toHaveAttribute('href', destination);
});

test('public tooltip: native activation forwards child and wrapper clicks once and closes help', async ({
  page,
}) => {
  const example = await openExample(page, 'tooltip', 'tooltip-public');
  const control = example.getByRole('button', { name: 'Public tooltip control', exact: true });
  const portal = example.getByTestId('public-tooltip-portal');
  await control.focus();
  await expect(example.getByLabel('Public tooltip open', { exact: true })).toHaveText('true');
  await expect(portal.locator('[data-tooltip-content]')).toBeVisible();
  const descriptions = await control.getAttribute('aria-describedby');
  const ids = descriptions.split(/\s+/);
  expect(new Set(ids).size, 'Description IDs must not be duplicated by forwarding').toBe(
    ids.length,
  );
  await expect(control).toHaveAccessibleDescription(
    /The original public control description remains available/,
  );
  await control.press('Space');
  await expect(example.getByLabel('Public tooltip child clicks')).toHaveText('1');
  await expect(example.getByLabel('Public tooltip wrapper clicks')).toHaveText('1');
  await expect(example.getByLabel('Public tooltip pressed')).toHaveText('true');
  await expect(example.getByLabel('Public tooltip open', { exact: true })).toHaveText('false');
  await expect(control).toHaveAccessibleDescription(
    'The original public control description remains available.',
  );
  await expect(control).toBeFocused();
});

test('public tooltip: Element and selector targets contain live help and Escape retains focus', async ({
  page,
}) => {
  const example = await openExample(page, 'tooltip', 'tooltip-public');
  const control = example.getByRole('button', { name: 'Public tooltip control', exact: true });
  for (const selector of [false, true]) {
    if (selector)
      await example.getByRole('switch', { name: 'Use selector tooltip target' }).click();
    await control.focus();
    const content = example.getByTestId('public-tooltip-portal').locator('[data-tooltip-content]');
    await expect(content).toBeVisible();
    await expect(content).toContainText('Wrapped button help');
    await control.press('Escape');
    await expect(content).toBeHidden();
    await expect(control).toBeFocused();
  }
});
