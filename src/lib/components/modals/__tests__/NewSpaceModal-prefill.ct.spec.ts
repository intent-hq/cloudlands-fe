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
) {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Harness, {
    props: { prefillRequest: 0 },
    hooksConfig: {
      mockBackend: {
        'drafts.get': null,
        'drafts.set': null,
        'host.toolAvailability': { tools: { git: { available: true } } },
      },
      mockIpc: {
        'system:check-git': { success: true, data: { available: true, version: '2.50.0' } },
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
    await component.update({ props: { prefillRequest: 1 } });
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
