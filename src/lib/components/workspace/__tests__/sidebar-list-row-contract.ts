import type { ComponentFixtures } from '@playwright/experimental-ct-svelte';
import { expect } from '../../../../test/ct-test';

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
    const rendered = await label.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const text = range.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const card = node.closest('[data-row-card]')!.getBoundingClientRect();
      return {
        inside: rect.left >= card.left && rect.right <= card.right,
        textHeight: text.height,
        rowHeight: rect.height,
      };
    });
    expect(rendered.inside).toBe(true);
    expect(rendered.textHeight).toBeLessThanOrEqual(rendered.rowHeight);
  }

  const geometry = await component.evaluate((node) => {
    return {
      overflow: [...node.querySelectorAll('[data-row-card]')].some(
        (card) => card.scrollWidth > card.clientWidth,
      ),
    };
  });
  expect(geometry.overflow).toBe(false);

  const selection = component.locator('[data-row-selection]');
  const note = component.locator('[data-note-id="row-reference"] [data-slot="list-item"]');
  await note.press('Enter');
  await expect(selection).toContainText('"openedNote":"row-reference"');
  const agent = component.locator('[data-agent-panel-row="sidebar-row-agent-0"]');
  await agent.press('Enter');
  await expect(agent).toHaveAttribute('aria-current', 'true');
  await expect(selection).toContainText('"selectedAgentId":"sidebar-row-agent-0"');
  const tree = component.getByRole('tree');
  await tree.focus();
  await expect(tree).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(selection).toContainText('"selectedFile":"/sample/A-long-reference-document.md"');
  await component
    .locator('[data-row-card="Files"]')
    .getByRole('button', { name: 'src', exact: true })
    .click();
  await expect(component.getByText('sidebar-layout.ts', { exact: true })).toHaveCount(0);
  // Folder clicks return focus to the tree on the next animation frame (#5287).
  // Observe that handoff before the next click or a browser-row keyboard action.
  await expect(tree).toBeFocused();
  await component
    .locator('[data-row-card="Files"]')
    .getByRole('button', { name: 'src', exact: true })
    .click();
  await expect(component.getByText('sidebar-layout.ts', { exact: true })).toBeVisible();
  await expect(tree).toBeFocused();

  const browsers = component.locator('[data-row-card="Browsers"]');
  const visibleBrowser = browsers.getByRole('button', { name: 'Interface reference', exact: true });
  await visibleBrowser.focus();
  await expect(visibleBrowser).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(selection).toContainText('"openedBrowser":"row-browser"');
  const hiddenBrowser = browsers.getByRole('button', {
    name: /A deliberately long hidden browser page title/,
  });
  await expect(hiddenBrowser).toBeEnabled();
  await hiddenBrowser.focus();
  await expect(hiddenBrowser).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(selection).toContainText('"openedBrowser":"row-browser-hidden"');
}
