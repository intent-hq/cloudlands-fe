import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tokenCss = readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
const surfaces = ['workspace', 'panel', 'subscription', 'chat', 'popover', 'form'] as const;

test('neutral surfaces share one opaque 1px border in both themes and zoom levels', async ({
  page,
}) => {
  for (const theme of ['light', 'dark']) {
    for (const zoom of [1, 2]) {
      await page.setContent(`
        <style>
          ${tokenCss}
          body { margin: 0; }
          #probes { display: flex; gap: 8px; }
          [data-surface] {
            box-sizing: content-box;
            width: 120px;
            height: 24px;
            border: 1px solid hsl(var(--border));
          }
        </style>
        <main id="probes">
          ${surfaces.map((surface) => `<div data-surface="${surface}"></div>`).join('')}
        </main>
      `);
      const styles = await page.evaluate(
        ({ theme, zoom }) => {
          document.documentElement.className = theme;
          document.body.style.zoom = String(zoom);
          return [...document.querySelectorAll<HTMLElement>('[data-surface]')].map((element) => {
            const style = getComputedStyle(element);
            return {
              surface: element.dataset.surface,
              color: style.borderTopColor,
              width: style.borderTopWidth,
              renderedWidth: element.getBoundingClientRect().width,
            };
          });
        },
        { theme, zoom },
      );

      expect(new Set(styles.map(({ color }) => color))).toHaveSize(1);
      expect(styles.every(({ color }) => color.startsWith('rgb('))).toBe(true);
      expect(styles.every(({ width }) => width === '1px')).toBe(true);
      for (const { renderedWidth } of styles) {
        expect(renderedWidth).toBeCloseTo(122 * zoom, 5);
      }
    }
  }
});
