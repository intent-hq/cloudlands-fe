import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const invalidSource = `unsupportedDiagram https://example.invalid/${'long-source-segment'.repeat(100)}`;
const validSource = 'graph LR\n A[Start] -->|continue| B[Finish]';
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function mountNote(page: Page, width: number) {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?state=mermaid-flow&motion=reduced`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(
    async ({ width, source }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'failure-note-host';
      host.style.cssText = `width:${width}px;height:900px`;
      document.body.replaceChildren(host);
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'failure-alignment-test',
            title: 'Failure alignment test',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-10T00:00:00.000Z',
            updatedAt: '2026-09-10T00:00:00.000Z',
          },
          content: `## Diagram failure\n\nAdjacent note text.\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\nFollowing note text.`,
          editable: true,
          showSuggestions: false,
          showComments: false,
        },
      });
    },
    { width, source: invalidSource },
  );
  await expect(page.locator('.mermaid-error')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
}

async function geometry(page: Page) {
  return page.locator('.node-mermaidBlock').evaluate((lane) => {
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    };
    const card = lane.querySelector<HTMLElement>('.mermaid-error')!;
    const note = lane.closest<HTMLElement>('.note-content-container')!;
    return {
      prose: bounds(lane.previousElementSibling!),
      card: bounds(card),
      lane: bounds(lane),
      actions: bounds(lane.querySelector('[data-diagram-presentation-actions]')!),
      details: bounds(card.querySelector('details')!),
      localOverflow: card.scrollWidth - card.clientWidth,
      noteOverflow: note.scrollWidth - note.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      blocks: [...card.querySelectorAll('pre')].map((e) => ({
        ...bounds(e),
        scroll: e.scrollWidth,
        client: e.clientWidth,
        overflow: getComputedStyle(e).overflowX,
      })),
    };
  });
}

for (const [name, width] of [
  ['wide', 1336],
  ['narrow', 420],
  ['layout threshold', 712],
] as const) {
  test(`aligns ${name} note failures and restores the successful lane`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await mountNote(page, width);
    const lane = page.locator('.node-mermaidBlock');
    const card = lane.locator('.mermaid-error');
    const details = card.locator('details');
    await expect(card.getByRole('alert')).toBeVisible();
    const samples = [];
    for (const expanded of [false, true]) {
      if (expanded) {
        await details.locator('summary').focus();
        await page.keyboard.press('Enter');
      }
      await expect(details).toHaveJSProperty('open', expanded);
      const result = await geometry(page);
      samples.push({ expanded, ...result });
      await testInfo.attach(`geometry-${expanded}`, {
        body: JSON.stringify(result),
        contentType: 'application/json',
      });
      await page
        .locator('#failure-note-host')
        .screenshot({ path: testInfo.outputPath(`${expanded ? 'expanded' : 'collapsed'}.png`) });
      expect(Math.abs(result.card.left - result.prose.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(result.card.right - result.prose.right)).toBeLessThanOrEqual(1);
      expect(result.localOverflow).toBeLessThanOrEqual(1);
      expect(result.noteOverflow).toBeLessThanOrEqual(1);
      expect(result.pageOverflow).toBeLessThanOrEqual(1);
      expect(result.actions.left).toBeGreaterThanOrEqual(result.prose.left - 1);
      expect(result.actions.right).toBeLessThanOrEqual(result.prose.right + 1);
      if (expanded) {
        expect(result.blocks).toHaveLength(2);
        for (const block of result.blocks) {
          expect(block.left).toBeGreaterThanOrEqual(result.card.left);
          expect(block.right).toBeLessThanOrEqual(result.card.right);
          if (block.scroll > block.client + 1) expect(block.overflow).toBe('auto');
        }
        await expect(card.locator('.error-message')).toContainText('https://example.invalid/');
        await expect(card.locator('.error-source-code')).toHaveText(invalidSource);
      }
    }
    await page.keyboard.press('Enter');
    await expect(details).toHaveJSProperty('open', false);
    await lane.hover();
    await lane.getByRole('button', { name: 'Edit code', exact: true }).click();
    await lane.locator('textarea').fill(validSource);
    const renderer = lane.locator('.mermaid-renderer');
    await expect(card).toHaveCount(0);
    await expect(renderer).toHaveAttribute('data-render-settled', 'true', { timeout: 30_000 });
    await expect(renderer.locator('.mermaid-svg svg')).toHaveAttribute(
      'data-layout-settled',
      'true',
    );
    await expect(renderer.locator('g.node')).toHaveCount(2);
    await expect(renderer.locator('.edgePaths path')).toHaveCount(1);
    await expect(
      renderer.locator('.edgeLabels > .edgeLabel').filter({ hasText: 'continue' }),
    ).toHaveCount(1);
    const recovered = await lane.boundingBox();
    expect(recovered!.width).toBeGreaterThan(samples[0].prose.width);
    const generation = await renderer.getAttribute('data-render-generation');
    const svg = await renderer.locator('.mermaid-svg > svg').elementHandle();
    const start = Date.now();
    await expect
      .poll(
        async () => {
          expect(await renderer.getAttribute('data-render-generation')).toBe(generation);
          expect(await svg!.evaluate((e) => e.isConnected)).toBe(true);
          expect((await lane.boundingBox())!.width).toBe(recovered!.width);
          const painted = await renderer.evaluate((element) => {
            const viewport = element
              .querySelector('.mermaid-svg-viewport')!
              .getBoundingClientRect();
            return [
              ...element.querySelectorAll('g.node, .edgePaths path, .edgeLabels > .edgeLabel'),
            ].map((e) => {
              const r = e.getBoundingClientRect();
              return (
                (r.width > 0 || r.height > 0) &&
                r.left >= viewport.left - 1 &&
                r.right <= viewport.right + 1 &&
                r.top >= viewport.top - 1 &&
                r.bottom <= viewport.bottom + 1
              );
            });
          });
          expect(painted).toHaveLength(4);
          expect(painted.every(Boolean)).toBe(true);
          return Date.now() - start;
        },
        { timeout: 15_000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(10_000);
  });
}
