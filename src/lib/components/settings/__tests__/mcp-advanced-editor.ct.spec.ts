import { expect, test } from '../../../../test/ct-test';
import McpAdvancedEditor from '../mcp-advanced-editor.preview.svelte';
import type { McpServerConfig } from '../mcp/types';

test('same-name server actions and JSON round trips preserve the other server', async ({
  mount,
  page,
}, testInfo) => {
  const errors: string[] = [];
  const saves: McpServerConfig[][] = [];
  const restarts: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const servers: McpServerConfig[] = [
    {
      id: 'desktop-one',
      name: 'Agent World desktop tools',
      type: 'http',
      url: 'http://localhost:8001/mcp',
    },
    {
      id: 'desktop-two',
      name: 'Agent World desktop tools',
      type: 'http',
      url: 'http://localhost:8002/mcp',
    },
  ];
  const root = await mount(McpAdvancedEditor, {
    props: {
      servers,
      interactive: true,
      statuses: [
        { serverId: 'desktop-one', state: 'running' },
        { serverId: 'desktop-two', state: 'error', lastError: 'Second server failed' },
      ],
      onPersist: (configs: McpServerConfig[]) => {
        saves.push(configs);
      },
      onRestart: (id: string) => {
        restarts.push(id);
      },
    },
  });
  const rows = root.locator('[data-slot="list-view-item"]');
  const first = rows.filter({ hasText: 'http://localhost:8001/mcp' });
  const second = rows.filter({ hasText: 'http://localhost:8002/mcp' });
  await expect(first.getByText('Connected', { exact: true })).toBeVisible();
  await expect(second.getByText('Second server failed', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect.poll(() => restarts).toEqual(['desktop-two']);
  await expect(second.getByText('Connected', { exact: true })).toBeVisible();
  await first.getByRole('switch').click();
  await expect.poll(() => saves.at(-1)?.find((s) => s.id === 'desktop-one')?.disabled).toBe(true);
  expect(saves.at(-1)?.find((s) => s.id === 'desktop-two')?.disabled).not.toBe(true);
  await expect(second.getByRole('switch')).toHaveAttribute('aria-checked', 'true');

  await second.getByRole('button', { name: 'Actions for Agent World desktop tools' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await root.getByPlaceholder('https://example.com/mcp').fill('http://localhost:8003/mcp');
  await root.getByRole('button', { name: 'Update Server', exact: true }).click();
  await expect
    .poll(() => saves.at(-1)?.find((s) => s.id === 'desktop-two')?.url)
    .toBe('http://localhost:8003/mcp');
  expect(saves.at(-1)?.find((s) => s.id === 'desktop-one')).toMatchObject({
    ...servers[0],
    disabled: true,
  });

  const disclosure = root.getByRole('button', { name: /Advanced: Edit Servers as JSON/ });
  await disclosure.click();
  const editor = root.getByRole('textbox', { name: 'MCP server configuration JSON' });
  const exported = JSON.parse(await editor.inputValue()).mcpServers;
  expect(exported).toHaveLength(2);
  expect(exported.map((s: McpServerConfig) => s.id)).toEqual(['desktop-one', 'desktop-two']);
  const beforeSave = saves.length;
  await root.getByRole('button', { name: 'Save Settings', exact: true }).click();
  await expect.poll(() => saves.length).toBeGreaterThan(beforeSave);
  expect(saves.at(-1)).toEqual(exported);
  await disclosure.click();

  await rows
    .filter({ hasText: 'http://localhost:8003/mcp' })
    .getByRole('button', { name: 'Actions for Agent World desktop tools' })
    .click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect.poll(() => saves.at(-1)?.map((s) => s.id)).toEqual(['desktop-one']);
  expect(saves.at(-1)?.[0]).toMatchObject({ ...servers[0], disabled: true });
  expect(errors).toEqual([]);
  await testInfo.attach('independent-server-actions', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
  await testInfo.attach('saved-server-configurations', {
    body: JSON.stringify(saves, null, 2),
    contentType: 'application/json',
  });
});

test('Connections renders servers with duplicate names and legacy entries without IDs', async ({
  mount,
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const root = await mount(McpAdvancedEditor, {
    props: {
      servers: [
        {
          id: 'desktop-one',
          name: 'Agent World desktop tools',
          type: 'http',
          url: 'http://localhost:8001/mcp',
        },
        {
          id: 'desktop-two',
          name: 'Agent World desktop tools',
          type: 'http',
          url: 'http://localhost:8002/mcp',
        },
        { name: 'Legacy server', type: 'stdio', command: 'legacy-mcp' },
      ],
    },
  });
  await expect(root.locator('[data-slot="list-view-item"]')).toHaveCount(3);
  await expect(root.getByText('Agent World desktop tools', { exact: true })).toHaveCount(2);
  await expect(root.getByText('http://localhost:8001/mcp', { exact: true })).toBeVisible();
  await expect(root.getByText('http://localhost:8002/mcp', { exact: true })).toBeVisible();
  await expect(root.getByText('Legacy server', { exact: true })).toBeVisible();
  const trigger = root.getByRole('button', { name: /Advanced: Edit Servers as JSON/ });
  await trigger.click();
  await expect(root.getByRole('textbox', { name: 'MCP server configuration JSON' })).toBeVisible();
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
  await testInfo.attach('connections-duplicate-names', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
});

for (const width of [420, 1100]) {
  test(`MCP disclosure stays inside its row and supports keyboard activation at ${width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(McpAdvancedEditor);
    const trigger = root.getByRole('button', { name: /Advanced: Edit Servers as JSON/ });
    const editor = root.getByRole('textbox', { name: 'MCP server configuration JSON' });
    await page.evaluate(() => document.fonts.ready);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const measure = () =>
      trigger.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const label = element.querySelector('[data-slot="button-label"]')!;
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        return {
          topInset: text.top - row.top,
          bottomInset: row.bottom - text.bottom,
          overflow: element.scrollWidth - element.clientWidth,
          height: row.height,
        };
      });
    const initial = await measure();
    expect(initial.topInset).toBeGreaterThanOrEqual(0);
    expect(initial.bottomInset).toBeGreaterThanOrEqual(0);
    expect(initial.overflow).toBeLessThanOrEqual(1);
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(editor).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect((await measure()).height).toBe(initial.height);
    await trigger.click();
    await expect(editor).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
}
