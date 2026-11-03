import { expect, test } from '../../../../test/ct-test';
import WorkspaceForm from './workspace-form.preview.svelte';

const dialogName = 'New Workspace';

test('first workspace keeps adding a codebase discoverable with no repository history', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await mount(WorkspaceForm, { props: { scenario: 'empty', modal: true } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  await expect(dialog.getByRole('button', { name: /Create workspace/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /^Select a branch:/ })).toHaveCount(0);
  const codebase = dialog.getByRole('button', { name: /^Codebase\b/ });
  await codebase.click();
  const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
  const add = picker.getByRole('button', { name: 'Add codebase', exact: true });
  await expect(add).toBeInViewport();
  await picker.getByRole('searchbox').fill('no-such-codebase');
  await expect(add).toBeVisible();
  await expect(add).toBeEnabled();
  await testInfo.attach('first-workspace-empty-codebases', {
    body: await page.screenshot({ path: testInfo.outputPath('first-workspace.png') }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(codebase).toBeFocused();
  await expect(dialog).toBeVisible();
});

test('new workspace pickers restore focus and preserve the prompt when dismissed', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await mount(WorkspaceForm, { props: { modal: true } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const prompt = dialog.locator('[contenteditable=true]');
  await prompt.fill('Refine the workspace navigation.');
  for (const name of [/^Add context$/, /^Start dictation$/, /^Add files/]) {
    await dialog.getByRole('button', { name }).hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await prompt.hover();
    await expect(page.getByRole('tooltip')).toBeHidden();
  }
  const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
  await branch.focus();
  await branch.press('Enter');
  const option = page.getByRole('option', { name: 'release/next', exact: true });
  await expect(option).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Branch', exact: true }).getByRole('combobox'),
  ).toBeFocused();
  await expect(page.getByRole('dialog', { name: 'Branch', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await option.click();
  await expect(branch).toBeFocused();
  await expect(branch).toContainText('release/next');
  await branch.press('Enter');
  await expect(option).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(option).toBeHidden();
  await expect(branch).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(prompt).toHaveText('Refine the workspace navigation.');
  const panels = [
    {
      trigger: dialog.getByRole('button', { name: /^Codebase\b/ }),
      popup: page.getByRole('dialog', { name: 'Codebase', exact: true }),
    },
    {
      trigger: dialog.getByRole('button', { name: /^Model / }),
      popup: page.locator('[data-slot="dropdown-content"]:visible'),
    },
  ];
  for (const { trigger, popup } of panels) {
    await trigger.click();
    await expect(popup).toBeVisible();
    await expect(popup).toBeInViewport({ ratio: 1 });
    await expect(popup.getByRole('searchbox')).toBeFocused();
    if (await popup.getByTestId('repo-form-search').count()) {
      const external = popup.getByRole('link', { name: 'Open in external browser', exact: true });
      const repositoryLink = external.and(
        popup.locator('[href="https://github.com/fixture-owner/app"]'),
      );
      await expect(repositoryLink).toBeVisible();
      await repositoryLink.click();
      await expect(page.getByTestId('workspace-external-links')).toHaveText(
        JSON.stringify(['https://github.com/fixture-owner/app']),
      );
      await expect(popup).toBeVisible();
      await expect(trigger).toContainText('intent');
      await expect(branch).toContainText('release/next');
      await repositoryLink.focus();
      await repositoryLink.press('Enter');
      await expect(page.getByTestId('workspace-external-links')).toHaveText(
        JSON.stringify([
          'https://github.com/fixture-owner/app',
          'https://github.com/fixture-owner/app',
        ]),
      );
      await expect(popup).toBeVisible();
      const selected = popup.getByRole('button', { name: /intent-hq.*intent/ });
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveAttribute('data-selected', '');
      await selected.focus();
      await selected.press('Enter');
      await expect(popup).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(branch).toContainText('release/next');
      await trigger.click();
      await expect(selected).toHaveCount(1);
      await popup.getByRole('searchbox').fill('intent-hq/intent');
      await expect(selected).toBeVisible();
    }
    if (await popup.getByRole('button', { name: 'Cancel', exact: true }).count()) {
      await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(prompt).toHaveText('Refine the workspace navigation.');
    await trigger.press('Enter');
    await expect(popup.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  const model = dialog.getByRole('button', { name: /^Model / });
  await model.click();
  const modelPanel = page.locator('[data-slot="dropdown-content"]:visible');
  const modelSearch = modelPanel.getByRole('searchbox');
  await modelSearch.fill('GPT');
  const clearSearch = modelPanel.getByRole('button', { name: 'Clear search', exact: true });
  await clearSearch.focus();
  await clearSearch.press('Enter');
  await expect(modelSearch).toHaveValue('');
  await expect(modelPanel).toBeVisible();
  const refreshModels = modelPanel.getByTestId('model-provider-refresh-button');
  await refreshModels.focus();
  await refreshModels.press('Enter');
  await expect(modelPanel).toBeVisible();
  await expect(refreshModels).toBeEnabled();
  const effort = modelPanel.getByTestId('effort-picker-trigger');
  await effort.focus();
  await effort.press('Enter');
  await expect(page.getByRole('option', { name: 'High', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(effort).toBeFocused();
  await expect(modelPanel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modelPanel).toBeHidden();
  await expect(model).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(prompt).toHaveText('Refine the workspace navigation.');
  await testInfo.attach('wide-light', {
    body: await page.screenshot({ path: testInfo.outputPath('wide-light.png') }),
    contentType: 'image/png',
  });
  const agent = dialog.getByRole('button', { name: /^Initial agent / });
  await agent.focus();
  await agent.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Initial agent', exact: true })).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Initial agent', exact: true }).getByRole('combobox'),
  ).toBeFocused();
  await testInfo.attach('agent-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('agent-menu.png') }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(agent).toBeFocused();
  await expect(prompt).toHaveText('Refine the workspace navigation.');
  await agent.click();
  await page.getByRole('button', { name: 'Create new or manage specialists', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('long selections leave all form controls reachable in a narrow dark window', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.addInitScript(() => {
    document.documentElement.classList.add('dark');
  });
  await mount(WorkspaceForm, { props: { scenario: 'long', modal: true } });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const create = dialog.getByRole('button', { name: /Create workspace/ });
  await expect(create).toBeEnabled();
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeInViewport();
  await expect.poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const repo = dialog.getByRole('button', { name: /^Codebase\b/ });
  await repo.scrollIntoViewIfNeeded();
  await repo.click();
  const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
  await expect(picker).toBeVisible();
  await expect
    .poll(() =>
      picker.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
    )
    .toBe(true);
  await testInfo.attach('narrow-dark-repository-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('narrow-dark-repository-menu.png') }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(repo).toBeFocused();
  const model = dialog.getByRole('button', { name: /^Model / });
  await model.scrollIntoViewIfNeeded();
  await model.click();
  const modelPopup = page.locator('[data-slot="dropdown-content"]:visible');
  await expect(modelPopup.getByRole('searchbox')).toBeInViewport();
  await expect(modelPopup.getByRole('searchbox')).toBeFocused();
  await testInfo.attach('narrow-dark-model-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('narrow-dark-model-menu.png') }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(model).toBeFocused();
  const setup = dialog.getByRole('button', { name: 'Setup script', exact: true });
  await setup.scrollIntoViewIfNeeded();
  await setup.click();
  const setupPicker = page.getByRole('dialog', { name: 'Setup script', exact: true });
  await expect(setupPicker.getByRole('combobox')).toBeInViewport();
  const createScript = setupPicker.getByRole('button', { name: 'Create Script', exact: true });
  await createScript.scrollIntoViewIfNeeded();
  await expect(createScript).toBeInViewport();
  await testInfo.attach('narrow-dark-setup-picker', {
    body: await page.screenshot({ path: testInfo.outputPath('narrow-dark-setup-picker.png') }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(setupPicker).toBeHidden();
  await expect(setup).toBeFocused();
  await create.scrollIntoViewIfNeeded();
  await testInfo.attach('narrow-dark', {
    body: await page.screenshot({ path: testInfo.outputPath('narrow-dark.png') }),
    contentType: 'image/png',
  });
});

test('setup search applies choices and edit or create keeps drafts staged until saved', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await mount(WorkspaceForm, { props: { modal: true } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const prompt = dialog.locator('[contenteditable=true]');
  await prompt.fill('Keep this workspace draft.');
  const setup = dialog.getByRole('button', { name: 'Setup script', exact: true });
  await expect(setup).toContainText('From repo config');
  const originalFrame = await dialog.elementHandle();
  const picker = page.getByRole('dialog', { name: 'Setup script', exact: true });
  const search = picker.getByRole('combobox', { name: 'Setup script', exact: true });
  const popup = page.getByRole('dialog', { name: 'Setup Script', exact: true });
  const editor = popup.getByRole('textbox', { name: 'Editor content', exact: true });
  const code = popup.locator('.monaco-editor .view-lines');
  async function enterCommands(value: string) {
    // The dialog opens before its lazy editor and Monaco finish initializing.
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.focus();
    await expect(editor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(value);
    await expect(code).toContainText(value);
  }
  async function openEditor(create = false) {
    await setup.click();
    await picker
      .getByRole('button', { name: create ? 'Create Script' : 'Edit commands', exact: true })
      .click();
    await expect(picker).toBeHidden();
  }
  await setup.click();
  await expect(search).toBeFocused();
  await testInfo.attach('setup-picker', {
    body: await page.screenshot({ path: testInfo.outputPath('setup-picker.png') }),
    contentType: 'image/png',
  });
  await search.fill('rust');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await picker.getByRole('option', { name: 'Rust (cargo)', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(setup).toBeFocused();
  await expect(setup).toContainText('Rust (cargo)');
  await setup.click();
  await search.fill('repo');
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(setup).toContainText('From repo config');
  await expect(picker).toBeHidden();
  await expect(prompt).toHaveText('Keep this workspace draft.');
  await setup.click();
  await search.fill('no-matching-script');
  await expect(picker.getByRole('option')).toHaveCount(0);
  await picker.getByRole('button', { name: 'Edit commands', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  expect(await popup.evaluate((element, original) => element === original, originalFrame)).toBe(
    false,
  );
  expect(await originalFrame?.evaluate((element) => element.isConnected)).toBe(true);
  await enterCommands('echo cancelled-draft');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(setup).toContainText('From repo config');
  await expect(setup).toBeFocused();

  await openEditor(true);
  await expect(code).toHaveText('');
  await enterCommands('echo cancelled-new-script');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(setup).toContainText('From repo config');
  await openEditor();
  await expect(code).not.toContainText('cancelled-draft');
  await expect(code).not.toContainText('cancelled-new-script');
  await enterCommands('echo applied-commands');
  await popup.getByRole('button', { name: 'Save & Done', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(setup).toContainText('Custom');

  await openEditor();
  await expect(code).toContainText('echo applied-commands');
  await enterCommands('echo escape-discard');
  await popup.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await openEditor();
  await expect(code).toContainText('echo applied-commands');
  await expect(code).not.toContainText('escape-discard');
  await testInfo.attach('setup-editor', {
    body: await page.screenshot({ path: testInfo.outputPath('setup-editor.png') }),
    contentType: 'image/png',
  });
  await popup.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(setup).toBeFocused();
  await expect(dialog).toBeVisible();
  await expect(prompt).toHaveText('Keep this workspace draft.');
  await openEditor(true);
  await expect(code).toHaveText('');
  await enterCommands('echo created-commands');
  await popup.getByRole('button', { name: 'Save & Done', exact: true }).click();
  await openEditor();
  await expect(code).toContainText('echo created-commands');
  await popup.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(setup).toBeFocused();
  await expect(prompt).toHaveText('Keep this workspace draft.');
});

test('a missing repository keeps creation disabled without losing the draft', async ({
  mount,
  page,
}, testInfo) => {
  await mount(WorkspaceForm, { props: { scenario: 'empty', modal: true } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const prompt = dialog.locator('[contenteditable=true]');
  await prompt.fill('Start a new project.');
  await expect(dialog.getByRole('button', { name: /Create workspace/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /^Select a branch:/ })).toHaveCount(0);
  await expect(prompt).toHaveText('Start a new project.');
  await testInfo.attach('missing-repository', {
    body: await page.screenshot({ path: testInfo.outputPath('missing-repository.png') }),
    contentType: 'image/png',
  });
});
