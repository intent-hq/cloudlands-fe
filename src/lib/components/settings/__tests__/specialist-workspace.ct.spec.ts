import { expect, test } from '../../../../test/ct-test';
import Preview from '../specialist-workspace.preview.svelte';

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
