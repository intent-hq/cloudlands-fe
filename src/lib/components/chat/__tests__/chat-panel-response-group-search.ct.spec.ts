import { expect, test } from '../../../../test/ct-test';
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
  await disclosure.press('ControlOrMeta+f');
  const findBar = component.getByRole('search', { name: 'Find in panel' });
  const input = findBar.getByRole('textbox');
  await input.fill('Nested prose alignment reference');
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'true');

  await input.press('Escape');
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'false');

  await disclosure.click();
  await disclosure.press('ControlOrMeta+f');
  await findBar.getByRole('textbox').fill('Nested prose alignment reference');
  await findBar.getByRole('textbox').press('Escape');
  await expect(group).toHaveAttribute('data-chat-search-expanded', 'true');
});

test('search reveals only the reasoning body owner and preserves manual disclosure state', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 560, reasoningSearchOnly: true },
  });
  const inlineMessage = component.locator('[data-message-id="assistant-inline-search"]');
  const titledMessage = component.locator('[data-message-id="assistant-titled-search"]');
  const titledGroup = titledMessage.getByTestId('response-group');
  const titledDisclosure = titledGroup.getByTestId('response-group-disclosure');

  const inlineBody = inlineMessage.locator(
    '[data-chat-search-disclosure-id="reasoning:b:0:c:1:phase:0"]',
  );
  await expect(inlineBody).toHaveAttribute('data-chat-search-expanded', 'false');
  await expect(inlineMessage.getByRole('button', { name: 'Reasoning' })).toHaveCount(2);
  await expect(inlineMessage.locator('[data-chat-search-disclosure-id^="group:"]')).toHaveCount(0);
  await expect(inlineMessage.locator('[data-operational-expanded-content]')).toHaveCount(0);
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'false');

  await inlineMessage.getByRole('button', { name: 'Reasoning' }).first().focus();
  await page.keyboard.press('ControlOrMeta+f');
  const findBar = component.getByRole('search', { name: 'Find in panel' });
  const input = findBar.getByRole('textbox');
  await input.fill('Inline headingless search target');
  await expect(inlineBody).toHaveAttribute('data-chat-search-expanded', 'true');
  await expect(
    inlineMessage.getByText(
      'Inline headingless search target remains visible without opening anything.',
    ),
  ).toBeVisible();
  await expect(
    inlineMessage.getByText('Later inline reasoning stays visible in source order.'),
  ).toHaveCount(0);
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'false');
  await input.press('Escape');
  await expect(inlineBody).toHaveAttribute('data-chat-search-expanded', 'false');
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('ControlOrMeta+f');
  await findBar.getByRole('textbox').fill('Hidden titled reasoning search target');
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'true');
  const titledBody = titledGroup.locator(
    '[data-chat-search-disclosure-id="reasoning:b:0:c:1:phase:0"]',
  );
  await expect(titledBody).toHaveAttribute('data-chat-search-expanded', 'true');
  await expect(titledGroup.getByText('Hidden titled reasoning search target.')).toBeVisible();
  await findBar.getByRole('textbox').press('Escape');
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'false');

  await titledDisclosure.click();
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(titledBody).toHaveAttribute('data-chat-search-expanded', 'false');
  await titledBody.getByRole('button').click();
  await titledDisclosure.press('ControlOrMeta+f');
  await findBar.getByRole('textbox').fill('Hidden titled reasoning search target');
  await findBar.getByRole('textbox').press('Escape');
  await expect(titledDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(titledBody).toHaveAttribute('data-chat-search-expanded', 'true');
});

test('search reveals a grouped orphan result and restores manual disclosure state', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 560, groupedOrphanSearchOnly: true },
  });
  const group = component.locator('[data-chat-search-disclosure-id="group:b:0"]');
  const disclosure = group.getByTestId('response-group-disclosure');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

  await disclosure.focus();
  await disclosure.press('ControlOrMeta+f');
  const findBar = component.getByRole('search', { name: 'Find in panel' });
  await findBar.getByRole('textbox').fill('grouped-search-orphan-tool-marker');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(group.getByText('grouped-search-orphan-tool-marker', { exact: true })).toBeVisible();
  await findBar.getByRole('textbox').press('Escape');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

  await disclosure.click();
  await disclosure.press('ControlOrMeta+f');
  await findBar.getByRole('textbox').fill('grouped-search-orphan-tool-marker');
  await findBar.getByRole('textbox').press('Escape');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
});

test('search highlights a result query in the standalone payload instead of its card label', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatPanelOperationalGeometryHost, {
    props: { theme: 'light', zoom: 1, width: 560, groupedOrphanSearchOnly: true },
  });
  await component.getByText('Continue after grouped orphan search').focus();
  await page.keyboard.press('ControlOrMeta+f');
  await component.getByRole('search', { name: 'Find in panel' }).getByRole('textbox').fill('tool');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const highlight = CSS.highlights?.get('current-search-result') as
          Iterable<Range> | undefined;
        const range = highlight ? Array.from(highlight)[0] : undefined;
        const parent = range?.startContainer.parentElement;
        return {
          text: range?.toString().toLowerCase(),
          inPayload: Boolean(parent?.closest('[data-tool-result-payload]')),
        };
      }),
    )
    .toEqual({ text: 'tool', inPayload: true });
});
