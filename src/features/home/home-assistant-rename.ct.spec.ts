import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Assistant thread rename saves an inactive thread without switching chat', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const header = component.locator('[data-chief-header-row]');
  await expect(header.getByRole('heading')).toHaveText('Plan the next release');
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Keep this message while renaming');
  await testInfo.attach('assistant-rename-before', {
    body: await page.screenshot({ path: testInfo.outputPath('before.png') }),
    contentType: 'image/png',
  });
  const rename = sidebar.getByRole('button', {
    name: 'Rename thread Review open pull requests',
    exact: true,
  });
  await rename.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Rename thread', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Thread name', exact: true });
  await expect(input).toBeFocused();
  await input.fill('  Release review — 日本語  ');
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(
    sidebar.getByRole('option', { name: 'Release review — 日本語', exact: true }),
  ).toBeVisible();
  await expect(sidebar.getByRole('option', { selected: true })).toContainText(
    'Plan the next release',
  );
  await expect(header.getByRole('heading')).toHaveText('Plan the next release');
  await expect(
    sidebar.getByRole('button', { name: 'Rename thread Release review — 日本語', exact: true }),
  ).toBeFocused();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toEqual([
    { agentId: 'home-assistant-1', name: 'Release review — 日本語', workspaceId: '__chief__' },
  ]);
  await expect(composer).toHaveText('Keep this message while renaming');
  await page.evaluate(() => window.__homeAssistantRename!.hydrate('home-assistant-1'));
  await sidebar.getByRole('option', { name: 'Release review — 日本語', exact: true }).click();
  await expect(header.getByRole('heading')).toHaveText('Release review — 日本語');
  await expect(component.locator('.home-surface')).toContainText('Review open pull requests');
  await testInfo.attach('assistant-rename-after', {
    body: await page.screenshot({ path: testInfo.outputPath('after.png') }),
    contentType: 'image/png',
  });
  await testInfo.attach('rename-wire-calls.json', {
    body: JSON.stringify(await page.evaluate(() => window.__homeAssistantRename!.calls), null, 2),
    contentType: 'application/json',
  });
});

test('Assistant thread rename handles cancel, blank names, IME and duplicate submits', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  await component.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const rename = component
    .locator('[data-chief-header-row]')
    .getByRole('button', { name: /^Rename thread/ });
  await rename.click();
  const dialog = page.getByRole('dialog', { name: 'Rename thread', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Thread name', exact: true });
  const submit = dialog.getByRole('button', { name: 'Rename', exact: true });
  await expect(submit).toBeDisabled();
  await input.fill('  \t  ');
  await expect(submit).toBeDisabled();
  await input.press('Enter');
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  await input.fill('Discard this name');
  await input.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(rename).toBeFocused();
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'Plan the next release',
  );
  await rename.click();
  await expect(input).toHaveValue('Plan the next release');
  await input.fill('New thread planning');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    isComposing: true,
  });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  await page.evaluate(() => window.__homeAssistantRename!.holdNext());
  await input.press('Enter');
  await expect(submit).toBeDisabled();
  await expect(input).toBeDisabled();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(1);
  await testInfo.attach('assistant-rename-pending', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.__homeAssistantRename!.release());
  await expect(dialog).toHaveCount(0);
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'New thread planning',
  );
  await page.evaluate(() => window.__homeAssistantRename!.hydrate('home-assistant-0'));
  await expect(component.locator('[data-chief-header-row]').getByRole('heading')).toHaveText(
    'New thread planning',
  );
});

test('Assistant thread rename restores the title on failure and keeps the draft for retry', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  await component.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await page.evaluate(() => {
    window.__homeAssistantRename!.failNext();
    window.__homeAssistantRename!.holdNext();
  });
  const header = component.locator('[data-chief-header-row]');
  await header.getByRole('button', { name: /^Rename thread/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename thread', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Thread name', exact: true });
  await input.fill('Retry release planning');
  await input.press('Enter');
  await expect(header.getByRole('heading')).toHaveText('Retry release planning');
  await page.evaluate(() => window.__homeAssistantRename!.release());
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveValue('Retry release planning');
  await expect(header.getByRole('heading')).toHaveText('Plan the next release');
  await testInfo.attach('assistant-rename-failure', {
    body: await page.screenshot({ path: testInfo.outputPath('failure.png') }),
    contentType: 'image/png',
  });
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(header.getByRole('heading')).toHaveText('Retry release planning');
  await page.evaluate(() =>
    window.__homeAssistantRename!.hydrate('home-assistant-0', { messages: [] }),
  );
  await expect(header.getByRole('heading')).toHaveText('Retry release planning');
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(2);
});

test('Assistant thread rename stays usable with long names and virtualized history', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const component = await mount(Preview, { props: { scenario: 'assistant-many' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const list = sidebar.getByRole('listbox');
  await list.getByRole('option').first().focus();
  await page.keyboard.press('End');
  await list
    .getByRole('button', { name: 'Rename thread Assistant conversation 240', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Rename thread', exact: true });
  const input = dialog.getByRole('textbox', { name: 'Thread name', exact: true });
  const name = 'A long release plan with spaces — 日本語 — '.repeat(5);
  await input.fill(name);
  await page.evaluate(() => window.__homeAssistantRename!.holdNext());
  await input.press('Enter');
  await expect(input).toBeDisabled();
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(list.getByRole('button', { name: /^Rename thread A long release/ })).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.__homeAssistantRename!.release());
  await expect(dialog).toHaveCount(0);
  await list.getByRole('option').first().focus();
  await page.keyboard.press('End');
  const rename = list.getByRole('button', { name: `Rename thread ${name.trim()}`, exact: true });
  await expect(rename).toBeInViewport();
  await rename.click();
  await expect(input).toHaveValue(name.trim());
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(rename).toBeFocused();
  await testInfo.attach('assistant-rename-long-history', {
    body: await page.screenshot({ path: testInfo.outputPath('long-history.png') }),
    contentType: 'image/png',
  });
});

test('Assistant thread rename is absent in empty and collaborator views', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'empty' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  await expect(component.getByRole('button', { name: /^Rename thread/ })).toHaveCount(0);
  await component.update({ props: { scenario: 'collaborator' } });
  await expect(component.getByRole('tab', { name: 'Assistant', exact: true })).toHaveCount(0);
  await expect(component.getByRole('button', { name: /^Rename thread/ })).toHaveCount(0);
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  await testInfo.attach('assistant-rename-collaborator', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});
