import { expect, type ComponentFixtures } from '@playwright/experimental-ct-svelte';

// Keep locator and page types on the same Playwright version as CT's expect.
type Page = ReturnType<Awaited<ReturnType<ComponentFixtures['mount']>>['page']>;
type Locator = ReturnType<Page['locator']>;

export async function assertSidebarListRows(component: Locator, page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await component
    .locator('[data-context-skills]')
    .getByRole('button', { name: /Skills/ })
    .click();
  await component
    .locator('[data-context-mcp]')
    .getByRole('button', { name: /MCP servers/i })
    .click();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations))
        .map((animation) => animation.finished.catch(() => {})),
    ),
  );

  const labels = [
    ['Context', 'Implementation plan'],
    ['Context', 'Keyboard navigation'],
    ['Context', 'Reference notes with a deliberately long title for truncation'],
    ['Context', 'Interface reference'],
    ['Context', 'Interface craft'],
    ['Context', 'Project conventions'],
    ['Context', 'Local reference tools'],
    ['Agents', 'Interface reviewer'],
    ['Agents', 'A deliberately long implementation agent name'],
    ['Files', 'src'],
    ['Files', 'sidebar-layout.ts'],
    ['Files', 'A-long-reference-document.md'],
    ['Browsers', 'Interface reference'],
    ['Browsers', 'A deliberately long hidden browser page title'],
    ['Shells', 'Build shell'],
    ['Shells', 'Development server'],
    ['Shells', 'Run tests'],
  ];
  for (const [card, name] of labels) {
    const label = component.locator(`[data-row-card="${card}"]`).getByText(name, { exact: true });
    await expect(label).toHaveCSS('font-size', '15px');
    await expect(label).toHaveCSS('line-height', '22px');
    await expect(label).toHaveCSS('font-weight', '400');
    const rendered = await label.evaluate((node) => {
      const style = getComputedStyle(node);
      const axis = style.fontVariationSettings.match(/["']wght["']\s+([\d.]+)/);
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const card = node.closest('[data-row-card]')!.getBoundingClientRect();
      return {
        weight: Number(axis?.[1] ?? style.fontWeight),
        inside: rect.left >= card.left && rect.right <= card.right,
        textHeight: text.height,
        rowHeight: rect.height,
      };
    });
    expect(rendered.weight).toBe(400);
    expect(rendered.inside).toBe(true);
    expect(rendered.textHeight).toBeLessThanOrEqual(rendered.rowHeight);
  }

  const geometry = await component.evaluate((node) => {
    const agents = node.querySelector('[data-row-card="Agents"]')!;
    const heading = document.createRange();
    heading.selectNodeContents(agents.querySelector('[data-card-heading]')!);
    const avatar = agents.querySelector('[data-agent-avatar-with-state]')!.getBoundingClientRect();
    return {
      avatarInset: avatar.left - heading.getBoundingClientRect().left,
      overflow: [...node.querySelectorAll('[data-row-card]')].some(
        (card) => card.scrollWidth > card.clientWidth,
      ),
      fileRows: [...node.querySelectorAll('[data-file-path]')].map(
        (row) => row.getBoundingClientRect().height,
      ),
    };
  });
  expect(geometry.avatarInset).toBeCloseTo(0, 1);
  expect(geometry.overflow).toBe(false);
  expect(geometry.fileRows).toEqual([25, 25, 25]);
  await expect(component.getByText('https://example.test/reference', { exact: true })).toHaveCSS(
    'font-size',
    '13px',
  );

  const selection = component.locator('[data-row-selection]');
  const note = component.locator('[data-note-id="row-reference"] [data-slot="list-item"]');
  await note.press('Enter');
  await expect(selection).toContainText('"openedNote":"row-reference"');
  const agent = component.locator('[data-agent-panel-row="sidebar-row-agent-0"]');
  await agent.press('Enter');
  await expect(agent).toHaveAttribute('aria-current', 'true');
  await expect(selection).toContainText('"selectedAgentId":"sidebar-row-agent-0"');
  await expect(agent.getByTestId('agent-card-name')).toHaveCSS('font-weight', '400');

  const file = component.locator('[data-file-path="/sample/A-long-reference-document.md"]');
  const tree = component.getByRole('tree');
  await tree.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(selection).toContainText('"selectedFile":"/sample/A-long-reference-document.md"');
  await expect(file.getByText('A-long-reference-document.md', { exact: true })).toHaveCSS(
    'font-size',
    '15px',
  );
  await component
    .locator('[data-row-card="Files"]')
    .getByRole('button', { name: 'src', exact: true })
    .click();
  await expect(component.getByText('sidebar-layout.ts', { exact: true })).toHaveCount(0);
  await component
    .locator('[data-row-card="Files"]')
    .getByRole('button', { name: 'src', exact: true })
    .click();
  await expect(component.getByText('sidebar-layout.ts', { exact: true })).toBeVisible();

  const browsers = component.locator('[data-row-card="Browsers"]');
  await browsers.getByRole('button', { name: 'Interface reference', exact: true }).press('Enter');
  await expect(selection).toContainText('"openedBrowser":"row-browser"');
  await browsers
    .getByRole('button', { name: /A deliberately long hidden browser page title/ })
    .press('Enter');
  await expect(selection).toContainText('"openedBrowser":"row-browser-hidden"');
}
