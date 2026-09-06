import { expect, test } from '@playwright/experimental-ct-svelte';
import UntitledWorkspaceShellHost from './UntitledWorkspaceShellHost.svelte';

test.describe('new-workspace shell', () => {
  test('retains editor focus when capability probes settle', async ({ mount, page }) => {
    const component = await mount(UntitledWorkspaceShellHost, {
      props: { pendingCapabilities: true },
    });
    const editor = component.locator('.tiptap-editor');
    await editor.focus();

    await page.evaluate(() => window.dispatchEvent(new Event('new-workspace-probes-settled')));

    await expect(component.locator('[data-capability]')).toHaveCount(0);
    await expect(editor).toBeFocused();
  });

  test('starts from the editor with the keyboard shortcut', async ({ mount }) => {
    const component = await mount(UntitledWorkspaceShellHost);
    const editor = component.locator('.tiptap-editor');
    await editor.focus();
    await editor.press('Control+Enter');

    await expect(component.getByTestId('start-count')).toHaveText('1');
  });

  test('selects an inline provider when none is ready', async ({ mount }) => {
    const component = await mount(UntitledWorkspaceShellHost, {
      props: { providerMissing: true },
    });

    await expect(component.locator('[data-coordinator-state="connect-provider"]')).toBeVisible();
    await expect(component.getByText('SANDBOX-CODE')).toBeVisible();
    const provider = component.getByRole('button', { name: 'Use Augment Auggie' });
    await provider.focus();
    await provider.press('Enter');

    await expect(component.getByTestId('provider-selection-count')).toHaveText('1');
    await expect(component.locator('[data-coordinator-state]')).toHaveCount(0);
    await expect(component.getByTestId('draft-start')).toBeEnabled();
  });

  test('selects a fresh local project with a validated folder name', async ({ mount, page }) => {
    const component = await mount(UntitledWorkspaceShellHost);
    await component.getByTestId('prompt-actions-trigger').click();
    await page.getByRole('menuitem', { name: 'Start a new project' }).click();
    const input = page.getByRole('textbox', { name: 'Folder name' });
    await input.fill('fresh-project');
    await page.getByRole('button', { name: 'Select folder…' }).click();

    await expect(component.getByTestId('source-kind')).toHaveText('newFolder');
    await expect(component.getByTestId('source-name')).toHaveText('fresh-project');
  });

  test('rejects unsafe fresh-project folder names', async ({ mount, page }) => {
    const component = await mount(UntitledWorkspaceShellHost);
    await component.getByTestId('prompt-actions-trigger').click();
    await page.getByRole('menuitem', { name: 'Start a new project' }).click();
    const input = page.getByRole('textbox', { name: 'Folder name' });
    await input.fill('../outside');

    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(input).toHaveAccessibleDescription(/.+/);
    await expect(page.getByRole('button', { name: 'Select folder…' })).toBeDisabled();
    await expect(component.getByTestId('source-kind')).toBeEmpty();
    await input.fill('safe-project');
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await expect(input).not.toHaveAttribute('aria-describedby');
    await expect(page.getByRole('button', { name: 'Select folder…' })).toBeEnabled();
  });

  test('keeps the shell and composer contained at narrow width', async ({ mount, page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    const component = await mount(UntitledWorkspaceShellHost);
    const shell = component.getByRole('main', { name: 'Untitled workspace' });
    const shellBox = await shell.boundingBox();
    const composerBox = await component.getByTestId('draft-composer').boundingBox();

    expect(shellBox).not.toBeNull();
    expect(composerBox).not.toBeNull();
    expect(composerBox!.x).toBeGreaterThanOrEqual(shellBox!.x);
    expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(
      shellBox!.x + shellBox!.width + 1,
    );
  });

  test('does not render pending probes as missing guidance', async ({ mount }) => {
    const component = await mount(UntitledWorkspaceShellHost, {
      props: { pendingCapabilities: true },
    });

    await expect(component.locator('[data-capability]')).toHaveCount(0);
  });
});
