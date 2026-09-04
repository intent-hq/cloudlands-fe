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

    await expect(component.locator('[data-capability="git"]')).toHaveAttribute(
      'data-status',
      'ready',
    );
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
    await component.getByRole('button', { name: 'Use Augment Auggie' }).click();

    await expect(component.getByTestId('provider-selection-count')).toHaveText('1');
    await expect(component.locator('[data-coordinator-state="ready-idle"]')).toBeVisible();
  });

  test('selects a fresh local project with a validated folder name', async ({ mount }) => {
    const component = await mount(UntitledWorkspaceShellHost);
    const input = component.getByRole('textbox', { name: 'my-project' });
    await input.fill('fresh-project');
    await component.getByRole('button', { name: 'Select folder…' }).click();

    await expect(component.getByTestId('source-kind')).toHaveText('newFolder');
    await expect(component.getByTestId('source-name')).toHaveText('fresh-project');
  });

  test('rejects unsafe fresh-project folder names', async ({ mount }) => {
    const component = await mount(UntitledWorkspaceShellHost);
    const input = component.getByRole('textbox', { name: 'my-project' });
    await input.fill('../outside');

    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(component.locator('[data-source-state="new-folder-invalid"]')).toBeVisible();
    await expect(component.getByRole('button', { name: 'Select folder…' })).toBeDisabled();
    await expect(component.getByTestId('source-kind')).toBeEmpty();
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

  test('disables pending probe animation for reduced motion', async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(UntitledWorkspaceShellHost, {
      props: { pendingCapabilities: true },
    });
    const pendingCapability = component.locator('[data-capability="git"]');

    expect(
      await pendingCapability.evaluate((node) => node.getAnimations({ subtree: true }).length),
    ).toBe(0);
  });
});
