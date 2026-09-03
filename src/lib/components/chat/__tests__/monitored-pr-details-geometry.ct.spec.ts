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
    expect(geometry.rows).toHaveLength(5);
    for (const row of geometry.rows) {
      expect(row.value[0]).toBeGreaterThan(row.term[0]);
      expect(row.value[1]).toBeCloseTo(row.term[1], 1);
      expect(row.colors).toEqual(geometry.semanticColors);
    }
  }
});
