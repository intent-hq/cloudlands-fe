import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
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
  const colors = await error.evaluate((node) => {
    const probe = document.createElement('span');
    probe.style.color = 'hsl(var(--danger))';
    node.append(probe);
    const semantic = getComputedStyle(probe).color;
    probe.remove();

    const actual = getComputedStyle(node).color;

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
                chevron: [chevron.right, chevron.width],
                kebab: [kebab.left, kebab.right, kebab.width],
                overflow: [row.scrollWidth, row.clientWidth],
                colors: [titleColor, iconColor, kebabColor, mutedColor],
              };
            });
          expect(summaryGeometry.kebab[1]).toBeLessThanOrEqual(
            summaryGeometry.chevron[0] - summaryGeometry.chevron[1],
          );
          expect(summaryGeometry.overflow[0]).toBeLessThanOrEqual(summaryGeometry.overflow[1]);
          expect(summaryGeometry.colors.slice(0, -1)).toEqual([
            summaryGeometry.colors.at(-1),
            summaryGeometry.colors.at(-1),
            summaryGeometry.colors.at(-1),
          ]);
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
      status: measure('background-hook-state'),
      containment: { client: row.clientWidth, scroll: row.scrollWidth },
    };
  });
  expect(lanes.status.scroll).toBeGreaterThan(lanes.status.client);
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
