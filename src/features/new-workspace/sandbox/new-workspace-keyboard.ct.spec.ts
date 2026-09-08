import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import ScenarioContractHost from './ScenarioContractHost.svelte';

async function tabTo(page: Page, target: Locator, limit = 40): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((node) => node === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach ${await target.getAttribute('data-testid')}`);
}

async function expectVisibleFocus(target: Locator): Promise<void> {
  await expect(target).toBeFocused();
  expect(
    await target.evaluate((node) => {
      const style = getComputedStyle(node);
      return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
    }),
  ).toBe(true);
}

test('keyboard reaches the composer, source menu, and source picker', async ({ mount, page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(ScenarioContractHost, { props: { scenarioId: 'entry-pristine' } });
  const editor = component.locator('.tiptap-editor');
  await tabTo(page, editor);
  await expect(editor).toBeFocused();
  const composerSurface = component.getByTestId('message-input').locator('.rich-input-container');
  expect(await composerSurface.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(
    'none',
  );

  const actions = component.getByTestId('prompt-actions-trigger');
  await tabTo(page, actions);
  await expectVisibleFocus(actions);
  await page.keyboard.press('Enter');
  const newProject = page.getByRole('menuitem', { name: 'Start a new project' });
  await expect(newProject).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Folder name' })).toBeFocused();
});

test('setup options and recovery actions retain visible keyboard focus', async ({
  mount,
  page,
}) => {
  const component = await mount(ScenarioContractHost, {
    props: { scenarioId: 'source-local-repo' },
  });
  const expand = component.getByRole('button', { name: 'Expand project setup' });
  await tabTo(page, expand);
  await expectVisibleFocus(expand);
  await page.keyboard.press('Enter');
  const options = component.getByTestId('options-section');
  const summary = options.locator('summary');
  await tabTo(page, summary);
  await expectVisibleFocus(summary);
  await page.keyboard.press('Enter');
  const isolation = options.locator('button[aria-pressed]').first();
  await tabTo(page, isolation);
  await expectVisibleFocus(isolation);

  await component.unmount();
  const recovery = await mount(ScenarioContractHost, {
    props: { scenarioId: 'entry-restore-failed' },
  });
  const retry = recovery.getByRole('alert').getByRole('button');
  await tabTo(page, retry);
  await expectVisibleFocus(retry);
});
