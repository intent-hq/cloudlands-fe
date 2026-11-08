import { expect, test } from '../../../../test/ct-test';
import Harness from './NewSpacePrefillHarness.svelte';

const providers = Object.fromEntries(
  [
    'auggie',
    'claudeCode',
    'codex',
    'mock',
    'opencode',
    'cortex',
    'pi',
    'droid',
    'grok',
    'unsloth',
  ].map((id) => [id, { available: id === 'codex', authenticated: id === 'codex' }]),
);

async function mountOpenForm(
  mount: Parameters<Parameters<typeof test>[2]>[0]['mount'],
  page: Parameters<Parameters<typeof test>[2]>[0]['page'],
  options: { plainFolders?: boolean } = {},
) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Harness, {
    props: { prefillRequest: 0, plainFolders: options.plainFolders === true },
    hooksConfig: {
      mockBackend: {
        'drafts.get': null,
        'drafts.set': null,
        'host.toolAvailability': { tools: { git: { available: true } } },
      },
      mockIpc: {
        'system:check-git': { success: true, data: { available: true, version: '2.50.0' } },
        // Every probed folder is a plain (non-git) directory.
        'file:getDirectoryStatus': {
          success: true,
          data: { exists: true, isDirectory: true, isGitRepo: false },
        },
        'providers:get-availability': { success: true, data: { hasAnyProvider: true, providers } },
      },
    },
  });
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('design-system', { exact: true }).first()).toBeVisible();
  const request = async (prefill: object) => {
    await page.evaluate(
      (value) => sessionStorage.setItem('workspace-prefill', JSON.stringify(value)),
      prefill,
    );
    await component.update({
      props: { prefillRequest: 1, plainFolders: options.plainFolders === true },
    });
  };
  const prefillLeft = () => page.evaluate(() => sessionStorage.getItem('workspace-prefill'));
  return { dialog, request, prefillLeft };
}

test('an open New Workspace dialog re-reads the prefill when asked', async ({ mount, page }) => {
  const { dialog, request, prefillLeft } = await mountOpenForm(mount, page);
  await request({ repoPath: '/fixture/other-checkout' });
  await expect.poll(prefillLeft).toBeNull();
  await expect(dialog.getByText('other-checkout', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText('design-system', { exact: true })).toHaveCount(0);
});

test('an exact-remote GitHub prefill selects the GitHub repo, not its local clone', async ({
  mount,
  page,
}) => {
  const { dialog, request, prefillLeft } = await mountOpenForm(mount, page);
  await request({ githubUrl: 'https://github.com/octo/app', exactRemote: true });
  await expect.poll(prefillLeft).toBeNull();
  await expect(dialog.getByText('design-system', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('my-checkout', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Codebase octo\/app$/ })).toBeVisible();
});

test('a plain GitHub prefill (deep links, Home) still prefers a known local clone', async ({
  mount,
  page,
}) => {
  const { dialog, request, prefillLeft } = await mountOpenForm(mount, page);
  await request({ githubUrl: 'https://github.com/octo/app' });
  await expect.poll(prefillLeft).toBeNull();
  await expect(dialog.getByText('my-checkout', { exact: true }).first()).toBeVisible();
});

test('a Folder prefill opens the folder as a plain folder, not a git repo', async ({
  mount,
  page,
}) => {
  const { dialog, request, prefillLeft } = await mountOpenForm(mount, page, {
    plainFolders: true,
  });
  await expect(dialog.getByRole('button', { name: /^Select a branch/ })).toBeVisible();
  await request({ repoPath: '/fixture/notes', plainFolder: true });
  await expect.poll(prefillLeft).toBeNull();
  await expect(dialog.getByText('notes', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Select a branch/ })).toHaveCount(0);
});
