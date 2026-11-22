import type { Page } from '@playwright/test';
import { expect, test } from '../../test/ct-test';
import Harness from './home-prompt-picker-harness.svelte';

type Target = {
  ownerId: string;
  prompts: readonly string[];
  insert?: (text: string) => boolean;
} | null;
declare global {
  interface Window {
    __homePromptTarget: () => Target;
  }
}

const target = (page: Page) =>
  page.evaluate(() => {
    const current = window.__homePromptTarget();
    return current && { ownerId: current.ownerId, prompts: [...current.prompts] };
  });

test('Home preview chat feeds the Micro prompt picker without focus', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  const component = await mount(Harness);
  const composer = component.getByRole('textbox').last();
  await expect(composer).toBeVisible();
  await expect(composer).not.toBeFocused();

  await expect
    .poll(() => target(page))
    .toEqual({ ownerId: 'preview-link-agent', prompts: ['Run the tests.', 'Open the PR.'] });

  const inserted = await page.evaluate(
    () => window.__homePromptTarget()?.insert?.('Ship <it>\nthen report') ?? false,
  );
  expect(inserted).toBe(true);
  await expect(composer).toBeFocused();
  await expect(composer).toContainText('Ship <it>');
  await expect(composer).toContainText('then report');
  await testInfo.attach('home-prompt-picker-insert', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
});

test('Home preview chat stops serving the picker while its pane is inert', async ({
  mount,
  page,
}) => {
  await mount(Harness);
  await expect.poll(async () => (await target(page))?.ownerId).toBe('preview-link-agent');
  await page
    .locator('[data-home-prompt-picker]')
    .evaluate((pane) => pane.setAttribute('inert', ''));
  await expect.poll(() => target(page)).toBeNull();
});
