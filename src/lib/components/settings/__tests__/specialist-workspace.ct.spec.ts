import { expect, test } from '../../../../test/ct-test';
import Preview from '../specialist-workspace.preview.svelte';
import type { SpecialistDef } from '$lib/client/app-client';

const userOverride: SpecialistDef = {
  id: 'implementor',
  name: 'Customized implementor',
  description: 'A native user override of a built-in agent.',
  source: 'user',
  prompt: 'Use the custom implementation instructions.',
  path: '/tmp/user/.intent/specialists/implementor.md',
};

test('workspace built-in user overrides reset without deleting the catalog entry', async ({
  mount,
  page,
}, info) => {
  const view = await mount(Preview, { props: { definition: userOverride } });
  await expect(view.getByRole('heading', { name: userOverride.name })).toBeVisible();
  const reset = view.getByRole('button', { name: 'Reset', exact: true });
  await expect(reset).toBeVisible();
  await expect(view.getByRole('button', { name: 'Delete specialist' })).toHaveCount(0);
  await info.attach('builtin-override-before-reset', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await reset.click();
  await expect(view.getByTestId('delete-request')).toHaveText(
    JSON.stringify({ id: 'implementor', scope: 'user' }),
  );
  await view.getByTestId('switch-b').click();
  await expect(view.getByRole('textbox')).toHaveValue('Restored default prompt.');
  await expect(reset).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Delete specialist' })).toHaveCount(0);
  await info.attach('builtin-override-after-reset', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await view.getByTestId('empty-refresh').click();
  await expect(view.getByRole('heading', { name: userOverride.name })).toHaveCount(0);
  await expect(view.getByRole('button', { name: userOverride.name, exact: true })).toHaveCount(0);
});

for (const definition of [
  { ...userOverride, source: 'project' as const },
  { ...userOverride, importedFrom: 'claude-code' as const },
  { ...userOverride, id: 'custom-reviewer' },
]) {
  test(`workspace built-in identity excludes ${definition.importedFrom ?? definition.source} ${definition.id}`, async ({
    mount,
  }) => {
    const view = await mount(Preview, { props: { definition } });
    await expect(view.getByTestId('refresh-status')).toHaveText('loaded');
    await expect(view.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0);
    if (definition.importedFrom) {
      await expect(view.getByRole('textbox')).toHaveValue(definition.prompt ?? '');
      await expect(view.getByRole('textbox')).toHaveAttribute('readonly', '');
      await expect(view.getByRole('button', { name: 'Delete specialist' })).toHaveCount(0);
    } else {
      await expect(view.getByRole('button', { name: 'Delete specialist' })).toBeVisible();
    }
  });
}

test('Settings resolves project catalogs independently and keeps global discovery global', async ({
  mount,
  page,
}, info) => {
  const view = await mount(Preview);
  await expect(view.getByRole('heading', { name: 'Project A' })).toBeVisible();
  await expect(view.getByRole('textbox')).toHaveValue('Prompt A');
  await expect(view.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(view.getByTestId('requests')).toContainText('"includeProject":true');
  await info.attach('project-a-settings', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await view.getByTestId('switch-b').click();
  await expect(view.getByRole('heading', { name: 'Project B' })).toBeVisible();
  await expect(view.getByRole('textbox')).toHaveValue('Prompt B');
  await expect(view.getByTestId('specialist-import-warning')).toContainText('permissionMode');
  await view.locator('[data-editor] [data-open-combo-control]').getByRole('button').first().click();
  await expect(view.getByTestId('opens')).toContainText('/tmp/project-b/.claude/agents/shared.md');
  await info.attach('project-b-settings', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await view.getByTestId('fail-refresh').click();
  await expect(view.getByTestId('refresh-status')).toHaveText('failed');
  await expect(view.getByRole('heading', { name: 'Project B' })).toBeVisible();
  await view.getByTestId('empty-refresh').click();
  await expect(view.getByRole('heading', { name: 'Project B' })).toHaveCount(0);
  await expect(view.getByRole('region', { name: 'Claude agent import notices' })).toBeVisible();
  await view.getByTestId('switch-global').click();
  await expect(view.getByRole('heading', { name: 'User shared' })).toBeVisible();
  await expect(view.getByRole('textbox')).toHaveValue('User prompt');
  await expect(view.getByTestId('global-request')).not.toContainText('includeProject');
  await info.attach('project-catalog-settings', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

for (const message of [
  'Claude agent shared uses settings Intent cannot apply: permissionMode. Edit the original agent file or create an Intent specialist with the required behavior.',
  'Claude agent shared requires skills that are unavailable: review. Restore the required skills or update the original agent file.',
]) {
  test(`launch feedback preserves ${message.includes('requires') ? 'missing skill' : 'unsupported setting'} guidance`, async ({
    mount,
    page,
  }, info) => {
    const view = await mount(Preview, { props: { launchError: message } });
    await expect(view.getByRole('heading', { name: 'Project A' })).toBeVisible();
    await view.getByTestId('launch').click();
    await expect(view.getByTestId('feedback')).toContainText(message);
    await info.attach('launch-guidance', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('detail Open follows remote and local workspace locality reactively', async ({
  mount,
  page,
  context,
}, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const view = await mount(Preview, { props: { locality: 'remote' } });
  const detail = view.locator('[data-editor]');
  const path = '/tmp/project-a/.claude/agents/shared.md';
  await expect(detail.getByRole('heading', { name: 'Project A' })).toBeVisible();
  await expect(detail.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(detail.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Open in...' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Copy path', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(path);
  await expect(view.getByTestId('opens')).toHaveCount(0);
  await info.attach('remote-detail-copy-only', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await view.update({ props: { locality: 'local' } });
  await detail.getByRole('button', { name: 'Open', exact: true }).click();
  await expect
    .poll(async () => JSON.parse(await view.getByTestId('opens').innerText()))
    .toEqual({
      channel: 'vscode:open',
      args: [{ folder: '/tmp/project-a/.claude/agents', file: path }],
    });
  await info.attach('local-detail-editor', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await view.update({ props: { locality: 'remote' } });
  await expect(detail.getByRole('button', { name: 'Open', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Copy path', exact: true })).toBeVisible();
  await expect(detail.getByRole('textbox')).toHaveAttribute('readonly', '');
});
