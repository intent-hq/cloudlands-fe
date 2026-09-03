import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import BackgroundHooksRowGeometryHost from './BackgroundHooksRowGeometryHost.svelte';

test.setTimeout(120_000);

async function iconMotion(component: Locator) {
  return component
    .getByTestId('background-hook-icon')
    .locator('svg')
    .evaluate((node: SVGElement) => {
      const style = getComputedStyle(node);
      return {
        animation: style.animationName,
        transform: style.transform,
        transition: style.transitionDuration,
      };
    });
}

async function expectSemanticError(component: Locator) {
  const error = component.getByTestId('background-hook-last-error');
  await expect(error).toHaveClass(/(?:^|\s)text-error-foreground(?:\s|$)/);
  await expect(error).not.toHaveClass(/(?:^|\s)text-destructive(?:\s|$)/);
  const colors = await error.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'hsl(var(--error-foreground))';
    node.append(probe);
    const actual = getComputedStyle(node).color;
    const semantic = getComputedStyle(probe).color;
    probe.remove();
    return { actual, semantic };
  });
  expect(colors.actual).toBe(colors.semantic);
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    for (const width of [320, 720]) {
      for (const embedded of [false, true]) {
        test(`lays out the ${embedded ? 'embedded row' : 'standalone card'} in ${theme} at ${zoom * 100}% and ${width}px`, async ({
          mount,
          page,
        }) => {
          const component = await mount(BackgroundHooksRowGeometryHost, {
            props: { theme, zoom, width, embedded },
          });
          const summary = component.getByTestId('background-hook-summary');
          await summary.click();
          await expect(summary).toHaveAttribute('aria-expanded', 'true');

          const host = page.getByTestId('background-hooks-geometry-host');
          const card = component.getByTestId('background-hook-card');
          const title = component.locator('[id^="background-hook-title-"]');
          const metrics = component.locator('.background-hook-metric');
          await expect(metrics).toHaveCount(4);
          await expect(component.getByText('Next run', { exact: true })).toBeVisible();
          await expect(component.getByText('Interval', { exact: true })).toBeVisible();
          await expect(component.getByText('Expires', { exact: true })).toBeVisible();
          await expect(component.getByText('Runs', { exact: true })).toBeVisible();

          const containment = await host.evaluate((node) => ({
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
          }));
          expect(containment.scrollWidth).toBeLessThanOrEqual(containment.clientWidth);
          const cardContainment = await card.evaluate((node) => {
            const style = getComputedStyle(node);
            const bounds = node.getBoundingClientRect();
            const parentBounds = node.parentElement!.getBoundingClientRect();
            return {
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              width: bounds.width,
              parentWidth: parentBounds.width,
              margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
              radius: style.borderRadius,
              border: [
                style.borderTopWidth,
                style.borderRightWidth,
                style.borderBottomWidth,
                style.borderLeftWidth,
              ],
              shadow: style.boxShadow,
              background: style.backgroundColor,
            };
          });
          expect(cardContainment.scrollWidth).toBeLessThanOrEqual(cardContainment.clientWidth);
          if (embedded) {
            expect(cardContainment.margin.map(Number.parseFloat)).toEqual([0, 0, 0, 0]);
            expect(Number.parseFloat(cardContainment.radius)).toBe(0);
            expect(cardContainment.border.map(Number.parseFloat)).toEqual([0, 0, 0, 0]);
            expect(cardContainment.shadow).toBe('none');
            expect(cardContainment.background).toBe('rgba(0, 0, 0, 0)');
            expect(cardContainment.width).toBeCloseTo(cardContainment.parentWidth, 1);
            await expect(title).toHaveCSS('font-weight', '400');
          } else {
            expect(cardContainment.margin.map(Number.parseFloat).every((value) => value > 0)).toBe(
              true,
            );
            expect(Number.parseFloat(cardContainment.radius)).toBeGreaterThan(0);
            expect(cardContainment.border.map(Number.parseFloat).every((value) => value > 0)).toBe(
              true,
            );
            expect(cardContainment.shadow).not.toBe('none');
            expect(cardContainment.background).not.toBe('rgba(0, 0, 0, 0)');
            await expect(title).toHaveCSS('font-weight', '500');
          }

          const iconBox = await component
            .getByTestId('background-hook-icon')
            .locator('svg')
            .boundingBox();
          expect(iconBox?.width).toBeCloseTo(14 * zoom, 1);
          expect(iconBox?.height).toBeCloseTo(14 * zoom, 1);

          const summaryGeometry = await component
            .getByTestId('background-hook-summary-row')
            .evaluate((row) => {
              const bounds = row.getBoundingClientRect();
              const leading = row
                .querySelector<HTMLElement>('[data-testid="background-hook-icon"]')!
                .getBoundingClientRect();
              const title = row
                .querySelector<HTMLElement>('[data-testid="background-hook-title"]')!
                .getBoundingClientRect();
              const chevron = row
                .querySelector<HTMLElement>('[data-testid="background-hook-chevron"]')!
                .getBoundingClientRect();
              const kebab = row
                .querySelector<HTMLElement>('[data-testid="background-hook-chip"]')!
                .getBoundingClientRect();
              const mutedProbe = document.createElement('span');
              mutedProbe.style.color = 'hsl(var(--muted-foreground))';
              row.append(mutedProbe);
              const titleColor = getComputedStyle(
                row.querySelector<HTMLElement>('[data-testid="background-hook-title"]')!,
              ).color;
              const iconColor = getComputedStyle(
                row.querySelector<HTMLElement>('[data-testid="background-hook-icon"]')!,
              ).color;
              const kebabColor = getComputedStyle(
                row.querySelector<HTMLElement>('[data-testid="background-hook-chip"]')!,
              ).color;
              const mutedColor = getComputedStyle(mutedProbe).color;
              mutedProbe.remove();
              return {
                row: [bounds.left, bounds.right, bounds.height],
                leading: [leading.left, leading.width],
                titleLeft: title.left,
                chevronWidth: chevron.width,
                kebab: [kebab.right, kebab.width],
                overflow: [row.scrollWidth, row.clientWidth],
                colors: [titleColor, iconColor, kebabColor, mutedColor],
              };
            });
          expect(summaryGeometry.row[2]).toBeCloseTo(36 * zoom, 1);
          expect(summaryGeometry.leading[1]).toBeCloseTo(20 * zoom, 1);
          expect(summaryGeometry.titleLeft - summaryGeometry.row[0]).toBeCloseTo(40 * zoom, 1);
          expect(summaryGeometry.chevronWidth).toBeCloseTo(24 * zoom, 1);
          expect(summaryGeometry.kebab[1]).toBeCloseTo(24 * zoom, 1);
          expect(summaryGeometry.row[1] - summaryGeometry.kebab[0]).toBeCloseTo(12 * zoom, 1);
          expect(summaryGeometry.overflow[0]).toBeLessThanOrEqual(summaryGeometry.overflow[1]);
          expect(summaryGeometry.colors.slice(0, -1)).toEqual([
            summaryGeometry.colors.at(-1),
            summaryGeometry.colors.at(-1),
            summaryGeometry.colors.at(-1),
          ]);

          const boxes = await metrics.evaluateAll((nodes) =>
            nodes.map((node) => {
              const box = node.getBoundingClientRect();
              const label = node.querySelector('dt')!.getBoundingClientRect();
              const value = node.querySelector('dd')!.getBoundingClientRect();
              return {
                top: box.top,
                left: box.left,
                label: [label.left, label.top],
                value: [value.left, value.top],
              };
            }),
          );
          const shouldStack = width / zoom <= 512;
          if (shouldStack) {
            expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(4);
            for (const box of boxes) {
              expect(box.value[0]).toBeGreaterThan(box.label[0]);
              expect(box.value[1]).toBeCloseTo(box.label[1], 1);
            }
          } else {
            expect(new Set(boxes.map(({ top }) => Math.round(top))).size).toBe(1);
            expect(boxes.map(({ left }) => left)).toEqual(
              [...boxes.map(({ left }) => left)].sort((a, b) => a - b),
            );
          }
        });
      }
    }
  }
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2]) {
    for (const embedded of [false, true]) {
      for (const running of [false, true]) {
        test(`keeps the ${running ? 'running' : 'scheduled'} ${embedded ? 'embedded' : 'standalone'} hourglass and error token static in ${theme} at ${zoom * 100}%`, async ({
          mount,
        }) => {
          const component = await mount(BackgroundHooksRowGeometryHost, {
            props: { theme, zoom, embedded, running, lastError: true },
          });
          const summary = component.getByTestId('background-hook-summary');
          await summary.click();

          const motion = await iconMotion(component);
          expect(motion.animation).toBe('none');
          expect(motion.transform).toBe('none');

          await expectSemanticError(component);
        });
      }
    }
  }
}

test('uses one internal separator between embedded hooks without gaps or doubled strokes', async ({
  mount,
}) => {
  const component = await mount(BackgroundHooksRowGeometryHost, {
    props: { embedded: true, hookCount: 3 },
  });
  const cards = component.getByTestId('background-hook-card');
  await expect(cards).toHaveCount(3);

  const geometry = await cards.evaluateAll((nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        borderTop: style.borderTopWidth,
        borderBottom: style.borderBottomWidth,
      };
    }),
  );
  expect(geometry.map(({ borderTop }) => Number.parseFloat(borderTop))).toEqual([0, 1, 1]);
  expect(geometry.map(({ borderBottom }) => Number.parseFloat(borderBottom))).toEqual([0, 0, 0]);
  expect(geometry[1].top).toBeCloseTo(geometry[0].bottom, 1);
  expect(geometry[2].top).toBeCloseTo(geometry[1].bottom, 1);
});

test('preserves the hook name before secondary labels at 280px', async ({ mount }) => {
  const component = await mount(BackgroundHooksRowGeometryHost, {
    props: { embedded: true, width: 280 },
  });
  const summary = component.getByTestId('background-hook-summary');
  const lanes = await summary.evaluate((row) => {
    const measure = (testId: string) => {
      const node = row.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
      return {
        width: node.getBoundingClientRect().width,
        client: node.clientWidth,
        scroll: node.scrollWidth,
      };
    };
    return {
      title: measure('background-hook-title'),
      state: measure('background-hook-state'),
      nextRun: measure('background-hook-next-run'),
      containment: { client: row.clientWidth, scroll: row.scrollWidth },
    };
  });

  expect(lanes.title.width).toBeGreaterThanOrEqual(64);
  expect(lanes.title.width).toBeGreaterThan(lanes.state.width);
  expect(lanes.title.width).toBeGreaterThan(lanes.nextRun.width);
  expect([lanes.state, lanes.nextRun].some(({ client, scroll }) => scroll > client)).toBe(true);
  expect(lanes.containment.scroll).toBeLessThanOrEqual(lanes.containment.client);
});

test('supports keyboard disclosure and reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(BackgroundHooksRowGeometryHost, {
    props: { width: 320, zoom: 2, running: true, lastError: true },
  });
  const summary = component.getByTestId('background-hook-summary');
  await summary.focus();
  await summary.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await summary.press('Space');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');

  const motion = await iconMotion(component);
  expect(motion.animation).toBe('none');
  expect(motion.transform).toBe('none');
  expect(Number.parseFloat(motion.transition)).toBeLessThan(0.001);

  await summary.press('Enter');
  await expectSemanticError(component);
});
