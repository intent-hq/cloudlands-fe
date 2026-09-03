import { expect, test } from '@playwright/experimental-ct-svelte';
import MonitoredPrsRowGeometryHost from './MonitoredPrsRowGeometryHost.svelte';

test('aligns expanded details with the PR label and uses readable label-value columns', async ({
  mount,
  page,
}) => {
  const component = await mount(MonitoredPrsRowGeometryHost);

  for (const zoom of [1, 2]) {
    await component.update({ props: { zoom } });
    const summary = component.getByTestId('monitored-pr-summary');
    if ((await summary.getAttribute('aria-expanded')) !== 'true') await summary.click();
    await page.waitForTimeout(180);

    const geometry = await component.evaluate((root) => {
      const label = root.querySelector<HTMLElement>('[data-testid="monitored-pr-label"]')!;
      const details = root.querySelector<HTMLElement>('[data-testid="monitored-pr-details"]')!;
      const summaryRow = root.querySelector<HTMLElement>(
        '[data-testid="monitored-pr-summary-row"]',
      )!;
      const kebab = root.querySelector<HTMLElement>('[data-testid="monitored-pr-chip"]')!;
      const chevron = root.querySelector<HTMLElement>('[data-testid="monitored-pr-chevron"]')!;
      const summaryBounds = summaryRow.getBoundingClientRect();
      const kebabBounds = kebab.getBoundingClientRect();
      const chevronBounds = chevron.getBoundingClientRect();
      const foregroundProbe = document.createElement('span');
      const mutedProbe = document.createElement('span');
      foregroundProbe.style.color = 'hsl(var(--foreground))';
      mutedProbe.style.color = 'hsl(var(--muted-foreground))';
      root.append(foregroundProbe, mutedProbe);
      const rows = Array.from(details.querySelectorAll('dt')).map((term) => {
        const termBounds = term.getBoundingClientRect();
        const valueBounds = term.nextElementSibling!.getBoundingClientRect();
        return {
          term: [termBounds.left, termBounds.top],
          value: [valueBounds.left, valueBounds.top],
          colors: [getComputedStyle(term).color, getComputedStyle(term.nextElementSibling!).color],
        };
      });
      const result = {
        labelLeft: label.getBoundingClientRect().left,
        detailsLeft: details.firstElementChild!.getBoundingClientRect().left,
        trailing: {
          rowRight: summaryBounds.right,
          kebabRight: kebabBounds.right,
          kebabWidth: kebabBounds.width,
          chevronLeft: chevronBounds.left,
          chevronRight: chevronBounds.right,
          chevronWidth: chevronBounds.width,
        },
        rows,
        semanticColors: [
          getComputedStyle(mutedProbe).color,
          getComputedStyle(foregroundProbe).color,
        ],
      };
      foregroundProbe.remove();
      mutedProbe.remove();
      return result;
    });

    expect(geometry.detailsLeft).toBeCloseTo(geometry.labelLeft, 1);
    expect(geometry.trailing.kebabWidth).toBeCloseTo(24 * zoom, 1);
    expect(geometry.trailing.chevronWidth).toBeCloseTo(24 * zoom, 1);
    expect(geometry.trailing.kebabRight).toBeLessThanOrEqual(geometry.trailing.chevronLeft);
    expect(geometry.trailing.rowRight - geometry.trailing.chevronRight).toBeCloseTo(12 * zoom, 1);
    expect(geometry.rows).toHaveLength(5);
    for (const row of geometry.rows) {
      expect(row.value[0]).toBeGreaterThan(row.term[0]);
      expect(row.value[1]).toBeCloseTo(row.term[1], 1);
      expect(row.colors).toEqual(geometry.semanticColors);
    }
  }
});
