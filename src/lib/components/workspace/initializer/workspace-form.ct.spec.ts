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
  test.setTimeout(60_000);
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

const LAYOUT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAeklEQVR42g3JIQEEIRAAwE93IQixAZAIAiCQBNgAyBFEINEzdn5fKCFCCzNkEG74fVWpomrVrLJS3fqiK110rZtddrrbXwxliKENc8jBcMeLpSyxtGUuuVjuepFKitTSTJmkmy+2ssXWtrnlZrv7xVGOONoxjzwc9/gDMGt4gVaPnpMAAAAASUVORK5CYII=',
  'base64',
);

for (const theme of ['light', 'dark'] as const) {
  test(`attachments keep the first agent on the chosen machine (${theme})`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1100, height: 640 });
    if (theme === 'dark')
      await page.addInitScript(() => document.documentElement.classList.add('dark'));
    await mount(WorkspaceForm, { props: { scenario: 'remote-attachments', modal: true } });
    if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    const machine = dialog.getByRole('button', { name: /^Machine / });
    await expect(machine).toContainText('Mac mini');
    await dialog.locator('[contenteditable=true]').fill('Fix the layout in the screenshot');
    await dialog
      .locator('input[type=file]')
      .first()
      .setInputFiles([
        { name: 'layout.png', mimeType: 'image/png', buffer: LAYOUT_PNG },
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Steps to reproduce') },
      ]);
    await expect(dialog.getByTestId('new-workspace-attachments')).toBeVisible();
    await expect(dialog.getByTestId('start-on-locked-reason')).toHaveCount(0);
    await expect(machine).toBeEnabled();
    await expect(machine).toContainText('Mac mini');
    await testInfo.attach(`remote-attachments-${theme}`, {
      body: await page.screenshot({ path: testInfo.outputPath(`remote-attachments-${theme}.png`) }),
      contentType: 'image/png',
    });
  });
}

// These regressions exercise the real modal and picker, including their keyboard boundaries.
for (const acceptance of ['Add codebase', 'history'] as const) {
  test(`workspace selection recovery retains branch and draft through ${acceptance}`, async ({
    mount,
    page,
  }, testInfo) => {
    // Two representative captures, not a theme/viewport cross-product.
    await page.setViewportSize({
      width: acceptance === 'history' ? 390 : 1200,
      height: 800,
    });
    await mount(WorkspaceForm, { props: { modal: true, scenario: 'selection-recovery' } });
    if (acceptance === 'history') {
      await page.evaluate(() => document.documentElement.classList.add('dark'));
    }
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    const create = dialog.getByRole('button', { name: /Create workspace/ });
    const prompt = dialog.locator('[contenteditable=true]');
    const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
    await expect(create).toBeEnabled();
    await prompt.fill('Keep my recovery draft.');
    await branch.click();
    await page.getByRole('option', { name: 'release/next', exact: true }).click();
    await expect(branch).toContainText('release/next');
    await testInfo.attach('before-reaccepting', {
      body: await page.screenshot({ path: testInfo.outputPath('before-reaccepting.png') }),
      contentType: 'image/png',
    });
    const requestsBefore = await page.getByTestId('workspace-branch-requests').textContent();
    const codebase = dialog.getByRole('button', { name: /^Codebase\b/ });
    await codebase.click();
    const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
    if (acceptance === 'Add codebase') {
      await picker.getByRole('button', { name: 'Add codebase', exact: true }).click();
      const input = picker.getByRole('combobox');
      await expect(input).toHaveValue('intent-hq/intent');
      await input.press('Enter');
    } else {
      await picker.getByRole('button', { name: /intent-hq.*intent/ }).press('Enter');
    }
    await expect(picker).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(codebase).toBeFocused();
    await expect(branch).toContainText('release/next');
    await expect(create).toBeEnabled();
    await expect(prompt).toHaveText('Keep my recovery draft.');
    await expect(page.getByTestId('workspace-submissions')).toHaveText('[]');
    await expect(page.getByTestId('workspace-branch-requests')).toHaveText(requestsBefore!);
    await testInfo.attach('after-reaccepting', {
      body: await page.screenshot({ path: testInfo.outputPath('after-reaccepting.png') }),
      contentType: 'image/png',
    });
    await testInfo.attach('selection-recovery.json', {
      body: JSON.stringify({
        acceptance,
        branch: await branch.innerText(),
        ready: await create.isEnabled(),
        draft: await prompt.innerText(),
        branchRequests: JSON.parse(requestsBefore!),
      }),
      contentType: 'application/json',
    });
    await create.click();
    await expect(page.getByTestId('workspace-submissions')).toHaveText(
      JSON.stringify([
        {
          repoPath: 'intent-hq/intent',
          branch: 'release/next',
          prompt: 'Keep my recovery draft.',
        },
      ]),
    );
    await testInfo.attach('retained-branch-submission.json', {
      body: (await page.getByTestId('workspace-submissions').textContent())!,
      contentType: 'application/json',
    });
  });
}

test('workspace selection recovery carries a pasted URL into Add and waits for its own branch', async ({
  mount,
  page,
}, testInfo) => {
  await mount(WorkspaceForm, { props: { modal: true, scenario: 'selection-recovery' } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const create = dialog.getByRole('button', { name: /Create workspace/ });
  const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
  const prompt = dialog.locator('[contenteditable=true]');
  await expect(create).toBeEnabled();
  await prompt.fill('Create the new application.');
  await branch.click();
  await page.getByRole('option', { name: 'release/next', exact: true }).click();
  await dialog.getByRole('button', { name: /^Codebase\b/ }).click();
  const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
  await picker.getByRole('searchbox').fill('https://github.com/fixture-owner/new-app');
  await picker.getByRole('button', { name: 'Add codebase', exact: true }).click();
  const input = picker.getByRole('combobox');
  await expect(input).toHaveValue('fixture-owner/new-app');
  await input.press('Enter');
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Codebase\b/ })).toContainText('new-app');
  await expect(page.getByTestId('workspace-branch-requests')).toContainText(
    '"repository":"fixture-owner/new-app","status":"loading"',
  );
  await expect(create).toBeDisabled();
  await expect(branch).not.toContainText('release/next');
  await testInfo.attach('new-repository-loading', {
    body: await page.screenshot({ path: testInfo.outputPath('new-repository-loading.png') }),
    contentType: 'image/png',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('workspace-form:release-branches')));
  await expect(branch).toContainText('develop');
  await expect(create).toBeEnabled();
  await expect(prompt).toHaveText('Create the new application.');
  await testInfo.attach('new-repository-ready', {
    body: await page.screenshot({ path: testInfo.outputPath('new-repository-ready.png') }),
    contentType: 'image/png',
  });
  await testInfo.attach('selection-recovery.json', {
    body: JSON.stringify({
      branch: await branch.innerText(),
      ready: await create.isEnabled(),
      draft: await prompt.innerText(),
      branchRequests: JSON.parse(
        (await page.getByTestId('workspace-branch-requests').textContent())!,
      ),
    }),
    contentType: 'application/json',
  });
});

for (const invalid of ['', 'not a repository']) {
  test(`workspace selection recovery rejects ${invalid ? 'invalid' : 'empty'} Add input after detection`, async ({
    mount,
    page,
  }, testInfo) => {
    await mount(WorkspaceForm, { props: { modal: true, scenario: 'selection-recovery' } });
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    await expect(dialog.getByRole('button', { name: /Create workspace/ })).toBeEnabled();
    await dialog.getByRole('button', { name: /^Codebase\b/ }).click();
    const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
    await picker.getByRole('button', { name: 'Add codebase', exact: true }).click();
    const input = picker.getByRole('combobox');
    await input.fill('https://github.com/fixture-owner/new-app');
    await expect(picker.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
    await input.fill(invalid);
    await input.press('Enter');
    await expect(picker).toBeVisible();
    await expect(input).toHaveValue(invalid);
    await expect(dialog.getByRole('button', { name: /^Codebase\b/ })).toContainText('intent');
    await expect(page.getByTestId('workspace-branch-requests')).not.toContainText('new-app');
    await testInfo.attach('invalid-add-input', {
      body: await page.screenshot({ path: testInfo.outputPath('invalid-add-input.png') }),
      contentType: 'image/png',
    });
  });
}

test('workspace selection recovery keeps the same repository access error blocking creation', async ({
  mount,
  page,
}, testInfo) => {
  await mount(WorkspaceForm, { props: { modal: true, scenario: 'selection-access-error' } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const create = dialog.getByRole('button', { name: /Create workspace/ });
  const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
  await expect(page.getByTestId('workspace-branch-requests')).toContainText('no-access');
  await expect(create).toBeDisabled();
  await branch.click();
  const branchPicker = page.getByRole('dialog', { name: 'Branch', exact: true });
  await expect(branchPicker.getByText("You don't have access to this repository.")).toBeVisible();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: /^Codebase\b/ }).click();
  const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
  await picker.getByRole('button', { name: 'Add codebase', exact: true }).click();
  await picker.getByRole('combobox').press('Enter');
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(create).toBeDisabled();
  await branch.click();
  await expect(branchPicker.getByText("You don't have access to this repository.")).toBeVisible();
  await testInfo.attach('same-repository-access-error', {
    body: await page.screenshot({ path: testInfo.outputPath('same-repository-access-error.png') }),
    contentType: 'image/png',
  });
});

test('workspace selection recovery ignores a late branch response after switching back', async ({
  mount,
  page,
}, testInfo) => {
  await mount(WorkspaceForm, { props: { modal: true, scenario: 'selection-recovery' } });
  const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
  const create = dialog.getByRole('button', { name: /Create workspace/ });
  const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
  const codebase = dialog.getByRole('button', { name: /^Codebase\b/ });
  const picker = page.getByRole('dialog', { name: 'Codebase', exact: true });
  await expect(create).toBeEnabled();
  await codebase.click();
  await picker.getByRole('button', { name: 'Add codebase', exact: true }).click();
  await picker.getByRole('combobox').fill('fixture-owner/new-app');
  await picker.getByRole('combobox').press('Enter');
  await expect(page.getByTestId('workspace-branch-requests')).toContainText(
    '"repository":"fixture-owner/new-app","status":"loading"',
  );
  await expect(create).toBeDisabled();
  await codebase.click();
  await picker.getByRole('button', { name: 'Add codebase', exact: true }).click();
  await picker.getByRole('combobox').fill('intent-hq/intent');
  await picker.getByRole('combobox').press('Enter');
  await expect(codebase).toContainText('intent');
  await expect(branch).toContainText('trunk');
  await expect(create).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('workspace-form:release-branches')));
  await expect(page.getByTestId('workspace-branch-requests')).toContainText(
    '"repository":"fixture-owner/new-app","status":"ready"',
  );
  await expect(branch).toContainText('trunk');
  await expect(create).toBeEnabled();
  await testInfo.attach('late-response-ignored', {
    body: await page.screenshot({ path: testInfo.outputPath('late-response-ignored.png') }),
    contentType: 'image/png',
  });
});

// Opening contracts intentionally never open either picker, except the explicit retry case.
const openingCases = [
  { scenario: 'opening-cold', name: 'cold lookup selects its default', expected: 'trunk' },
  { scenario: 'opening-saved', name: 'confirms a remembered branch', expected: 'main' },
  { scenario: 'opening-stale', name: 'replaces a missing remembered branch', expected: 'trunk' },
  {
    scenario: 'opening-error',
    name: 'stays unselected on failure and recovers on retry',
    expected: 'main',
  },
  { scenario: 'opening-empty', name: 'stays unselected with no branches', expected: null },
  { scenario: 'opening-warm', name: 'reconciles cached and fresh defaults', expected: 'trunk' },
  {
    scenario: 'opening-hydration',
    name: 'restores the repository after mount',
    expected: 'main',
  },
] as const;

for (const opening of openingCases) {
  test(`workspace form opening ${opening.name}`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await mount(WorkspaceForm, { props: { modal: true, scenario: opening.scenario } });
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    const create = dialog.getByRole('button', { name: /Create workspace/ });
    const prompt = dialog.locator('[contenteditable=true]');
    const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
    const requests = page.getByTestId('workspace-branch-requests');
    const submissions = page.getByTestId('workspace-submissions');
    const hydration = page.getByTestId('workspace-hydrated');
    const draft = 'Keep my opening draft.';
    await expect(dialog).toBeVisible();
    await prompt.fill(draft);
    await prompt.focus();

    async function capture(state: string) {
      await testInfo.attach(`opening-${state}`, {
        body: await page.screenshot({ path: testInfo.outputPath(`opening-${state}.png`) }),
        contentType: 'image/png',
      });
      await testInfo.attach(`opening-${state}.json`, {
        body: JSON.stringify({
          scenario: opening.scenario,
          hydrated: await hydration.textContent(),
          branch: (await branch.count()) ? await branch.innerText() : null,
          ready: await create.isEnabled(),
          draft: await prompt.innerText(),
          promptFocused: await prompt.evaluate((element) => element === document.activeElement),
          requests: JSON.parse((await requests.textContent())!),
          submissions: JSON.parse((await submissions.textContent())!),
        }),
        contentType: 'application/json',
      });
    }

    if (opening.scenario === 'opening-hydration') {
      // This must be an initial hydration, not a second action on an already-hydrated slice.
      await expect(hydration).toHaveText('false');
      await expect(branch).toHaveCount(0);
      await expect(create).toBeDisabled();
      await expect(requests).toHaveText('[]');
      await capture('before-hydration');
      await page.evaluate(() =>
        window.dispatchEvent(new Event('workspace-form:release-hydration')),
      );
      await expect(hydration).toHaveText('true');
    }
    await expect(requests).toContainText('"status":"loading"');
    await expect(submissions).toHaveText('[]');
    if (opening.scenario === 'opening-warm') {
      await expect(branch).toContainText('cached-default');
      await expect(create).toBeEnabled();
    } else {
      await expect(create).toBeDisabled();
      await expect(branch).toBeVisible();
      await expect(branch).not.toContainText('main');
    }
    await expect(prompt).toHaveText(draft);
    await expect(prompt).toBeFocused();
    await capture('pending');
    await page.evaluate(() => window.dispatchEvent(new Event('workspace-form:release-branches')));

    if (opening.scenario === 'opening-error' || opening.scenario === 'opening-empty') {
      await expect(requests).toContainText(
        opening.scenario === 'opening-error' ? '"status":"error"' : '"status":"empty"',
      );
      await expect(create).toBeDisabled();
      await expect(branch).not.toContainText('main');
      await expect(prompt).toHaveText(draft);
      await expect(prompt).toBeFocused();
      await expect(submissions).toHaveText('[]');
      await capture('blocked');
      if (opening.scenario === 'opening-empty') return;
      // Only recovery uses the picker; valid opening data needs no such interaction.
      await branch.click();
      const picker = page.getByRole('dialog', { name: 'Branch', exact: true });
      await picker.getByRole('button', { name: 'Refresh branches', exact: true }).click();
      await expect(requests).toContainText('"status":"retry-ready"');
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();
    } else {
      await expect(requests).toContainText('"status":"ready"');
      await expect(prompt).toBeFocused();
    }
    await expect(branch).toContainText(opening.expected!);
    await expect(create).toBeEnabled();
    await expect(prompt).toHaveText(draft);
    await expect(submissions).toHaveText('[]');
    await capture('ready');
    await create.click();
    await expect(submissions).toHaveText(
      JSON.stringify([{ repoPath: 'intent-hq/intent', branch: opening.expected, prompt: draft }]),
    );
    await testInfo.attach('opening-submission.json', {
      body: (await submissions.textContent())!,
      contentType: 'application/json',
    });
  });
}

for (const explicitBranch of [false, true]) {
  test(`workspace form opening late same-repository prefill ${explicitBranch ? 'honors an explicit branch' : 'retains the validated branch'}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await mount(WorkspaceForm, { props: { modal: true, scenario: 'opening-late-prefill' } });
    const dialog = page.getByRole('dialog', { name: dialogName, exact: true });
    const create = dialog.getByRole('button', { name: /Create workspace/ });
    const branch = dialog.getByRole('button', { name: /^Select a branch:/ });
    const prompt = dialog.locator('[contenteditable=true]');
    const requests = page.getByTestId('workspace-branch-requests');
    const submissions = page.getByTestId('workspace-submissions');
    const applications = page.getByTestId('workspace-prefill-applications');
    const draft = 'Keep my late prefill draft.';
    await expect(requests).toContainText('"repository":"/fixture/prefill","status":"ready"');
    await expect(branch).toContainText('release/next');
    await expect(create).toBeEnabled();
    await prompt.fill(draft);
    await prompt.focus();
    const originalPrompt = await prompt.elementHandle();
    const initialRequests = (await requests.textContent())!;
    await expect(submissions).toHaveText('[]');
    await expect(applications).toHaveText('0');
    await testInfo.attach('before-late-prefill', {
      body: await page.screenshot({ path: testInfo.outputPath('before-late-prefill.png') }),
      contentType: 'image/png',
    });
    // Invoke the real public method after branch validation, with the same local identity.
    // No parent state mutation, remount, branch picker click or fabricated branch event.
    await page.evaluate((override) => {
      sessionStorage.setItem(
        'workspace-prefill',
        JSON.stringify({ repoPath: '/fixture/prefill', ...(override ? { branch: 'trunk' } : {}) }),
      );
      window.dispatchEvent(new Event('workspace-form:apply-late-prefill'));
    }, explicitBranch);
    await expect(applications).toHaveText('1');
    expect(await page.evaluate(() => sessionStorage.getItem('workspace-prefill'))).toBeNull();
    const expectedBranch = explicitBranch ? 'trunk' : 'release/next';
    await expect(branch).toContainText(expectedBranch);
    await expect(create).toBeEnabled();
    await expect(requests).toHaveText(initialRequests);
    await expect(prompt).toHaveText(draft);
    await expect(prompt).toBeFocused();
    expect(await prompt.evaluate((element, original) => element === original, originalPrompt)).toBe(
      true,
    );
    await expect(submissions).toHaveText('[]');
    await testInfo.attach('after-late-prefill', {
      body: await page.screenshot({ path: testInfo.outputPath('after-late-prefill.png') }),
      contentType: 'image/png',
    });
    await testInfo.attach('late-prefill.json', {
      body: JSON.stringify({
        explicitBranch,
        branch: await branch.innerText(),
        ready: await create.isEnabled(),
        draft: await prompt.innerText(),
        prefillApplications: await applications.textContent(),
        branchRequests: JSON.parse((await requests.textContent())!),
      }),
      contentType: 'application/json',
    });
    await create.click();
    await expect(submissions).toHaveText(
      JSON.stringify([{ repoPath: '/fixture/prefill', branch: expectedBranch, prompt: draft }]),
    );
    await testInfo.attach('late-prefill-submission.json', {
      body: (await submissions.textContent())!,
      contentType: 'application/json',
    });
  });
}
