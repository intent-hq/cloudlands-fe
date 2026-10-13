import { expect, test } from '../../../../test/ct-test';
import MonitoredPrsRowGeometryHost from './MonitoredPrsRowGeometryHost.svelte';

test('aligns expanded details with the PR label as plain muted sentences', async ({
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
      const mutedProbe = document.createElement('span');
      mutedProbe.style.color = 'hsl(var(--muted-foreground))';
      root.append(mutedProbe);
      const lines = Array.from(details.children).map((line) => {
        const bounds = line.getBoundingClientRect();
        return {
          left: bounds.left,
          color: getComputedStyle(line).color,
          fontWeight: getComputedStyle(line).fontWeight,
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
        lines,
        mutedColor: getComputedStyle(mutedProbe).color,
      };
      mutedProbe.remove();
      return result;
    });

    expect(geometry.detailsLeft).toBeCloseTo(geometry.labelLeft, 1);
    expect(geometry.trailing.kebabWidth).toBeCloseTo(24 * zoom, 1);
    expect(geometry.trailing.chevronWidth).toBeCloseTo(24 * zoom, 1);
    expect(geometry.trailing.kebabRight).toBeLessThanOrEqual(geometry.trailing.chevronLeft);
    expect(geometry.trailing.rowRight - geometry.trailing.chevronRight).toBeCloseTo(12 * zoom, 1);
    expect(geometry.lines).toHaveLength(7);
    for (const line of geometry.lines) {
      expect(line.left).toBeCloseTo(geometry.labelLeft, 1);
      expect(line.color).toBe(geometry.mutedColor);
      expect(line.fontWeight).toBe('400');
    }
  }
});

for (const width of [360, 720]) {
  test(`qualified MR details leave both controls accessible at ${width}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 520 });
    const component = await mount(MonitoredPrsRowGeometryHost, {
      props: { provider: 'gitlab', width, referenceState: 'restricted' },
    });
    const summary = component.getByTestId('monitored-pr-summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(component.getByTestId('monitored-pr-details')).toBeVisible();
    const kebab = component.getByTestId('monitored-pr-chip');
    const chevron = component.getByTestId('monitored-pr-chevron');
    const a = (await kebab.boundingBox())!;
    const b = (await chevron.boundingBox())!;
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Tab');
    await expect(kebab).toBeFocused();
  });
}
