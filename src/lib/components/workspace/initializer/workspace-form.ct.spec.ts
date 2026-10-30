import { expect, test } from '../../../../test/ct-test';
import WorkspaceForm from './workspace-form.preview.svelte';

const dialogName = 'New Workspace';

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
  await testInfo.attach('wide-light', {
    body: await page.screenshot({ path: testInfo.outputPath('wide-light.png') }),
    contentType: 'image/png',
  });
  const agent = dialog.getByRole('button', { name: /^Agent / });
  await agent.focus();
  await agent.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await testInfo.attach('agent-menu', {
    body: await page.screenshot({ path: testInfo.outputPath('agent-menu.png') }),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(agent).toBeFocused();
  await expect(prompt).toHaveText('Refine the workspace navigation.');
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
  const repo = dialog.getByRole('button', { name: /^Select a repository:/ });
  await repo.scrollIntoViewIfNeeded();
  await repo.click();
  const picker = page.getByRole('dialog', { name: 'What repo should we work on?', exact: true });
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
  await create.scrollIntoViewIfNeeded();
  await testInfo.attach('narrow-dark', {
    body: await page.screenshot({ path: testInfo.outputPath('narrow-dark.png') }),
    contentType: 'image/png',
  });
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
