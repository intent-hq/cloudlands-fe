import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatPanelOperationalGeometryHost from './ChatPanelOperationalGeometryHost.svelte';

test.setTimeout(120_000);

test('search reveals a completed response group and restores only search-owned state', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 560 },
  });
  const group = component.locator('[data-chat-search-disclosure-id="group:b:7"]').first();
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'false');

  const disclosure = group.getByTestId('response-group-disclosure');
  await disclosure.focus();
  await disclosure.press('Meta+f');
  const findBar = component.getByRole('search', { name: 'Find in panel' });
  const input = findBar.getByRole('textbox');
  await input.fill('Nested prose alignment reference');
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'true');

  await input.press('Escape');
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'false');

  await disclosure.click();
  await disclosure.press('Meta+f');
  await findBar.getByRole('textbox').fill('Nested prose alignment reference');
  await findBar.getByRole('textbox').press('Escape');
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'true');
});
