import { expect, test, type Locator, type Page } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openDatabase(page: Page, width: number, theme: 'light' | 'dark' | 'nord') {
  const mode = theme === 'dark' ? 'dark' : 'light';
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=${mode}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 120_000 });
  if (theme === 'nord') {
    await page.getByTestId('catalog-color-theme-control').click();
    await page.getByRole('option', { name: 'Nord', exact: true }).click();
  }
  await page.locator('#custom-architecture .stepper-dot').nth(1).click();
  return page.locator('#custom-architecture [data-node-id="notes"] .diagram-node-html');
}

async function databaseGeometry(database: Locator) {
  return database.evaluate((body) => {
    const measure = (node: HTMLElement) => {
      const bounds = node.getBoundingClientRect();
      const row = node.querySelector<HTMLElement>('.node-row')!.getBoundingClientRect();
      const style = getComputedStyle(node);
      const scale = bounds.height / node.offsetHeight;
      const capBottom =
        Number.parseFloat(style.getPropertyValue('--store-cap-top')) +
        Number.parseFloat(style.getPropertyValue('--store-cap-height'));
      const bottomDepth = Number.parseFloat(style.getPropertyValue('--store-bottom-curve-depth'));
      const usableTop = bounds.top + capBottom * scale;
      const usableBottom = bounds.bottom - bottomDepth * scale;
      return {
        centerDelta: (row.top + row.bottom - usableTop - usableBottom) / 2,
        topSpace: row.top - usableTop,
        bottomSpace: usableBottom - row.bottom,
      };
    };
    const variants = [
      { lines: 1, kind: true },
      { lines: 1, kind: false },
      { lines: 2, kind: true },
      { lines: 2, kind: false },
    ].map(({ lines, kind }) => {
      const clone = body.cloneNode(true) as HTMLElement;
      clone.style.width = `${body.offsetWidth}px`;
      clone.style.height = `${body.offsetHeight}px`;
      clone.style.position = 'fixed';
      clone.style.left = '-1000px';
      clone.querySelector<HTMLElement>('.node-label')!.textContent =
        lines === 1 ? 'Persistent notes' : 'Persistent\nnotes';
      if (!kind) clone.querySelector('.node-kind-label')?.remove();
      document.body.append(clone);
      const geometry = measure(clone);
      clone.remove();
      return { lines, kind, ...geometry };
    });
    return { height: body.offsetHeight, variants };
  });
}

for (const theme of ['light', 'dark', 'nord'] as const) {
  for (const width of [320, 960] as const) {
    test(`centers database content in the usable ${theme} cylinder at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const database = await openDatabase(page, width, theme);
      await expect(database).toBeVisible();
      const geometry = await databaseGeometry(database);

      expect(geometry.height).toBe(90);
      for (const variant of geometry.variants) {
        expect(Math.abs(variant.centerDelta), JSON.stringify(variant)).toBeLessThanOrEqual(0.5);
        expect(variant.topSpace, JSON.stringify(variant)).toBeGreaterThanOrEqual(6);
        expect(variant.bottomSpace, JSON.stringify(variant)).toBeGreaterThanOrEqual(6);
      }
    });
  }
}
