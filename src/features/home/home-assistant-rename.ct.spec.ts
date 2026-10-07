import { expect, test } from '../../test/ct-test';
import Preview from './home.preview.svelte';

test('Assistant title edits inline without switching chat or losing a draft', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await sidebar.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const header = component.locator('[data-chief-header-row]');
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Keep this message while renaming');
  const title = sidebar.getByRole('button', {
    name: 'Rename thread Review open pull requests',
    exact: true,
  });
  await title.focus();
  await page.keyboard.press('Enter');
  const input = sidebar.getByRole('textbox', { name: 'Thread name', exact: true });
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Rename', exact: true })).toHaveCount(0);
  await testInfo.attach('assistant-title-editing', {
    body: await page.screenshot({ path: testInfo.outputPath('editing.png') }),
    contentType: 'image/png',
  });
  await input.fill('  Release review — 日本語  ');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  const renamed = sidebar.getByRole('option', { name: 'Release review — 日本語', exact: true });
  await expect(renamed).toBeVisible();
  await expect(sidebar.getByRole('option', { selected: true })).toContainText(
    'Plan the next release',
  );
  await expect(header.getByRole('heading')).toHaveText('Plan the next release');
  await expect(
    sidebar.getByRole('button', { name: 'Rename thread Release review — 日本語', exact: true }),
  ).toBeFocused();
  await expect(composer).toHaveText('Keep this message while renaming');
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toEqual([
    { agentId: 'home-assistant-1', name: 'Release review — 日本語', workspaceId: '__chief__' },
  ]);
  await page.evaluate(() => window.__homeAssistantRename!.hydrate('home-assistant-1'));
  await renamed.focus();
  await page.keyboard.press('Enter');
  await expect(header.getByRole('heading')).toHaveText('Release review — 日本語');
  await expect(component.locator('.home-surface')).toContainText('Review open pull requests');
  await testInfo.attach('assistant-title-after', {
    body: await page.screenshot({ path: testInfo.outputPath('after.png') }),
    contentType: 'image/png',
  });
  await testInfo.attach('rename-wire-calls.json', {
    body: JSON.stringify(await page.evaluate(() => window.__homeAssistantRename!.calls), null, 2),
    contentType: 'application/json',
  });
});

test('Assistant title handles unchanged input, blank names, Escape, IME and duplicate saves', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  await component.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const header = component.locator('[data-chief-header-row]');
  const title = header.getByRole('button', { name: /^Rename thread/ });
  const input = header.getByRole('textbox', { name: 'Thread name', exact: true });
  await title.click();
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  await title.click();
  await input.fill('  \t  ');
  await input.press('Enter');
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  await input.evaluate((element) => element.blur());
  await expect(input).toHaveCount(0);
  await title.click();
  await input.fill('Discard this name');
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(title).toBeFocused();
  await expect(header.getByRole('heading')).toHaveText('Plan the next release');
  await title.click();
  await expect(input).toHaveValue('Plan the next release');
  await input.fill('New thread planning');
  await input.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    isComposing: true,
  });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  await page.evaluate(() => window.__homeAssistantRename!.holdNext());
  await input.press('Enter');
  await expect(input).toBeDisabled();
  await expect(input).toHaveAttribute('aria-busy', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(1);
  await testInfo.attach('assistant-title-pending', {
    body: await page.screenshot({ path: testInfo.outputPath('pending.png') }),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.__homeAssistantRename!.release());
  await expect(input).toHaveCount(0);
  await expect(header.getByRole('heading')).toHaveText('New thread planning');
  await page.evaluate(() => window.__homeAssistantRename!.hydrate('home-assistant-0'));
  await expect(header.getByRole('heading')).toHaveText('New thread planning');
});

test('Assistant title saves on blur and row selection still works', async ({ mount, page }) => {
  const component = await mount(Preview, { props: { scenario: 'assistant' } });
  await component.getByRole('tab', { name: 'Assistant', exact: true }).click();
  const header = component.locator('[data-chief-header-row]');
  const composer = component.getByRole('textbox', { name: 'Message', exact: true });
  await header.getByRole('button', { name: /^Rename thread/ }).click();
  const input = header.getByRole('textbox', { name: 'Thread name', exact: true });
  await input.fill('Saved by clicking away');
  await composer.click();
  await expect(input).toHaveCount(0);
  await expect(header.getByRole('heading')).toHaveText('Saved by clicking away');
  await expect(composer).toBeFocused();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(1);
  await header.getByRole('button', { name: /^Rename thread/ }).click();
  await input.fill('Saved without a focus target');
  await input.evaluate((element) => element.blur());
  await expect(input).toHaveCount(0);
  await expect(header.getByRole('heading')).toHaveText('Saved without a focus target');
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(2);
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  const second = sidebar.getByRole('option', { name: 'Review open pull requests', exact: true });
  await second.click({ position: { x: 6, y: 6 } });
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(header.getByRole('heading')).toHaveText('Review open pull requests');
  await expect(component.getByRole('textbox', { name: 'Thread name', exact: true })).toHaveCount(0);
});

test('Assistant title keeps failed edits for retry and restores the saved title', async ({
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
  const sidebar = component.getByRole('navigation', { name: 'Home', exact: true });
  await header.getByRole('button', { name: /^Rename thread/ }).click();
  const input = header.getByRole('textbox', { name: 'Thread name', exact: true });
  await input.fill('Retry release planning');
  await input.press('Enter');
  await expect(
    sidebar.getByRole('option', { name: 'Retry release planning', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.__homeAssistantRename!.release());
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(input).toHaveValue('Retry release planning');
  await expect(input).toBeFocused();
  await expect(
    sidebar.getByRole('option', { name: 'Plan the next release', exact: true }),
  ).toBeVisible();
  await expect(component.getByRole('alert')).toContainText(
    'Could not rename this thread. Try again.',
  );
  await component.getByRole('textbox', { name: 'Message', exact: true }).click();
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(1);
  await testInfo.attach('assistant-title-failure', {
    body: await page.screenshot({ path: testInfo.outputPath('failure.png') }),
    contentType: 'image/png',
  });
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(header.getByRole('heading')).toHaveText('Retry release planning');
  await page.evaluate(() =>
    window.__homeAssistantRename!.hydrate('home-assistant-0', { messages: [] }),
  );
  await expect(header.getByRole('heading')).toHaveText('Retry release planning');
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(2);
});

test('Assistant title preserves editing and saves across virtualized long history', async ({
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
  const input = sidebar.getByRole('textbox', { name: 'Thread name', exact: true });
  await input.fill('Draft before scrolling — 日本語');
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(input).toHaveCount(0);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(input).toHaveValue('Draft before scrolling — 日本語');
  expect(await page.evaluate(() => window.__homeAssistantRename!.calls)).toHaveLength(0);
  const name = 'A long release plan with spaces — 日本語 — '.repeat(5);
  await input.fill(name);
  await page.evaluate(() => window.__homeAssistantRename!.holdNext());
  await input.press('Enter');
  await expect(input).toBeDisabled();
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(input).toHaveCount(0);
  await page.evaluate(() => window.__homeAssistantRename!.release());
  await list.getByRole('option').first().focus();
  await page.keyboard.press('End');
  const title = list.getByRole('button', { name: 'Rename thread ' + name.trim(), exact: true });
  await expect(title).toBeInViewport();
  await title.click();
  await expect(input).toHaveValue(name.trim());
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(title).toBeFocused();
  await testInfo.attach('assistant-title-long-history', {
    body: await page.screenshot({ path: testInfo.outputPath('long-history.png') }),
    contentType: 'image/png',
  });
});

test('Assistant title editing is absent in empty and collaborator views', async ({
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
  await testInfo.attach('assistant-title-collaborator', {
    body: await page.screenshot({ path: testInfo.outputPath('collaborator.png') }),
    contentType: 'image/png',
  });
});
