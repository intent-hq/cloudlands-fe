import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL ?? 'http://127.0.0.1:5173';

// The prose host and narrow host are separate width contracts; color is unchanged.
for (const width of [960, 420]) {
  test(`stateful note uses its lane and retains keyboard and export actions · ${width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(
      `${baseUrl}/sandbox/diagram-embedding?state=note&theme=light&width=${width}&motion=reduced`,
    );
    await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-ready', 'true', {
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press('Escape');
    const root = page.locator('[data-preview-note-diagram] .diagram-renderer');
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    const lane = await root.evaluate((element) => {
      const bounds = (node: Element) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      const host = element.closest('[data-preview-note-diagram]')!;
      const presentation = bounds(element.closest('[data-diagram-presentation]')!);
      const note = bounds(host.closest('article')!);
      const viewport = element.querySelector<HTMLElement>('.diagram-scroll-container')!;
      const labels = [...element.querySelectorAll<HTMLElement>('.node-label')].map((label) => {
        const matrix = label.closest<SVGGraphicsElement>('foreignObject')!.getScreenCTM()!;
        const scale = Math.hypot(matrix.a, matrix.b);
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        return {
          text: label.textContent,
          left: text.left,
          right: text.right,
          width: text.width,
          height: text.height,
          fontSize: Number.parseFloat(getComputedStyle(label).fontSize) * scale,
          scale,
        };
      });
      return {
        host: bounds(host),
        note,
        prose: [bounds(host.previousElementSibling!), bounds(host.nextElementSibling!)],
        presentation,
        viewport: bounds(viewport),
        footer: bounds(element.querySelector('.diagram-footer')!),
        labels,
        left: presentation.left - note.left,
        right: note.right - presentation.right,
        viewportOverflow: viewport.scrollWidth - viewport.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    await testInfo.attach('note-lane', {
      body: JSON.stringify(lane),
      contentType: 'application/json',
    });
    // The sandbox breakout wrapper can span the window. The note article, not
    // that wrapper, bounds usable space; readable content may use prose gutters.
    expect(lane.left).toBeGreaterThanOrEqual(0);
    expect(lane.right).toBeGreaterThanOrEqual(0);
    expect(lane.left).toBeCloseTo(lane.right, 0);
    for (const prose of lane.prose) {
      expect(lane.presentation.width).toBeGreaterThanOrEqual(prose.width);
      expect((lane.presentation.left + lane.presentation.right) / 2).toBeCloseTo(
        (prose.left + prose.right) / 2,
        0,
      );
      // This roomy host fits the small initial scene without spending gutters.
      // The narrow host instead permits intrinsic width beyond the prose minimum.
      if (width === 960) {
        expect(lane.presentation.left).toBeCloseTo(prose.left, 0);
        expect(lane.presentation.right).toBeCloseTo(prose.right, 0);
      }
    }
    expect(lane.labels.length).toBeGreaterThan(0);
    for (const label of lane.labels) {
      expect(label.width, label.text ?? '').toBeGreaterThan(0);
      expect(label.height, label.text ?? '').toBeGreaterThan(0);
      expect(label.fontSize, label.text ?? '').toBeGreaterThanOrEqual(12);
      expect(label.scale, label.text ?? '').toBeLessThanOrEqual(1);
      expect(label.left, label.text ?? '').toBeGreaterThanOrEqual(lane.viewport.left);
      expect(label.right, label.text ?? '').toBeLessThanOrEqual(lane.viewport.right);
    }
    expect(lane.footer.left).toBeCloseTo(lane.viewport.left, 0);
    expect(lane.footer.right).toBeCloseTo(lane.viewport.right, 0);
    expect(lane.viewportOverflow).toBeLessThanOrEqual(1);
    expect(lane.pageOverflow).toBeLessThanOrEqual(1);
    const initial = root.locator('[data-diagram-step-index="0"]');
    await initial.focus();
    await page.keyboard.press('End');
    await expect(root).toHaveAttribute('data-diagram-state', 'observe');
    await expect(root.locator('[data-diagram-step-index="2"]')).toBeFocused();
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await page.keyboard.press('Home');
    await expect(root).toHaveAttribute('data-diagram-state', 'orient');
    await expect(initial).toBeFocused();
    await expect(root).toHaveAttribute('data-diagram-settled', 'true');
    await root.screenshot({ path: testInfo.outputPath('note-initial.png') });
    await page.getByRole('button', { name: 'Diagram actions', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Download SVG', exact: true }).click();
    const exported = await download;
    expect(exported.suggestedFilename()).toMatch(/\.svg$/);
    expect(await exported.failure()).toBeNull();
  });
}
