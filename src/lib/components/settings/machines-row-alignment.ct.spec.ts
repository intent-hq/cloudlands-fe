import { expect, test } from '../../../test/ct-test';
import Harness from './DevicesPlatformsHarness.svelte';

/**
 * The row meta (platform icon, version, provider divider and icons, the
 * "Available to …" badge) must share the machine name's vertical centre.
 * `vertical-align: middle` centres on the baseline plus half the x-height,
 * which put every icon ~1.5px below the name and version text.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`Machines row meta is vertically centred on the name in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.evaluate(
      (value) => document.documentElement.classList.toggle('dark', value === 'dark'),
      theme,
    );
    await mount(Harness, { props: { theme } });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('article [role="list"]').first()).toBeVisible();

    const rows = await page.$$eval('article[aria-labelledby^="device-"]', (articles) =>
      articles.flatMap((article) => {
        const title = article.querySelector('[data-slot="list-row-title"]');
        const meta = title?.nextElementSibling;
        if (!title || !meta) return [];
        const centre = (rect: DOMRect) => rect.top + rect.height / 2;
        const textRect = (node: Node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect();
        };
        const name = centre(textRect(title));
        const parts: Array<{ part: string; offset: number }> = [];
        meta.querySelectorAll('svg').forEach((svg, index) => {
          parts.push({ part: `svg${index}`, offset: centre(svg.getBoundingClientRect()) - name });
        });
        meta.querySelectorAll('span').forEach((span) => {
          if (span.children.length === 0 && /\d+\.\d+/.test(span.textContent ?? ''))
            parts.push({ part: 'version', offset: centre(textRect(span)) - name });
        });
        const divider = meta.querySelector('[role="list"]');
        if (divider)
          parts.push({ part: 'divider', offset: centre(divider.getBoundingClientRect()) - name });
        meta.querySelectorAll('[data-slot="badge"]').forEach((badge) => {
          parts.push({ part: 'badge', offset: centre(badge.getBoundingClientRect()) - name });
        });
        return [{ name: title.textContent?.trim() ?? '', parts }];
      }),
    );

    const iconRows = rows.filter((row) => row.parts.some((part) => part.part.startsWith('svg')));
    expect(iconRows.length).toBeGreaterThanOrEqual(4);
    const misaligned = rows.flatMap((row) =>
      row.parts
        .filter((part) => Math.abs(part.offset) > 0.75)
        .map((part) => `${row.name} ${part.part} ${part.offset.toFixed(2)}px`),
    );
    expect(misaligned).toEqual([]);
  });
}
