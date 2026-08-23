import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceTokenUsageAccessibilityHost from './WorkspaceTokenUsageAccessibilityHost.svelte';

type Rgba = [number, number, number, number];

function luminance([red, green, blue]: Rgba): number {
  const channels = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('exposes compact values and keeps summary text readable on hover', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light', width: 280 },
  });
  const disclosure = component.locator('button[aria-controls^="workspace-token-usage-details-"]');

  await expect(disclosure).toHaveAccessibleDescription('1K processed 70% Cached');
  await disclosure.focus();
  await disclosure.press('Space');
  await expect(disclosure).toHaveAccessibleName('Collapse token usage details');
  await expect(disclosure).toHaveAccessibleDescription('1K processed 70% Cached');
  await disclosure.press('Enter');
  await expect(disclosure).toHaveAccessibleName('Expand token usage details');
  await disclosure.click();
  await expect(disclosure).toHaveAccessibleName('Collapse token usage details');
  const reducedDurations = await Promise.all([
    disclosure.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
    disclosure
      .locator('svg')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration)),
  ]);
  expect(reducedDurations.every((duration) => duration <= 0.001)).toBe(true);

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme, width: 280 } });
    await expect(component).toHaveAttribute('data-theme', theme);
    await disclosure.hover();
    const textColors = await disclosure
      .locator(
        [
          '#workspace-token-usage-processed-token-usage-accessibility-ct > span:not(.sr-only)',
          '#workspace-token-usage-cache-token-usage-accessibility-ct > span',
        ].join(', '),
      )
      .evaluateAll((elements) => {
        const paint = (values: string[]): [number, number, number, number] => {
          const canvas = document.createElement('canvas');
          canvas.width = 1;
          canvas.height = 1;
          const context = canvas.getContext('2d')!;
          for (const value of values) {
            context.fillStyle = value;
            context.fillRect(0, 0, 1, 1);
          }
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        return elements.map((element) => {
          const backgrounds: string[] = [];
          for (let node: Element | null = element; node; node = node.parentElement) {
            backgrounds.push(getComputedStyle(node).backgroundColor);
          }
          return {
            label: element.textContent?.trim() ?? '',
            foreground: paint([getComputedStyle(element).color]),
            background: paint(backgrounds.reverse()),
          };
        });
      });

    for (const colors of textColors) {
      expect(
        contrastRatio(colors.foreground, colors.background),
        `${theme} hover: ${colors.label}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('renders the full reference table as a wide overlay from the real workspace sidebar', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'dark', width: 304 },
  });
  const sidebar = component.getByTestId('workspace-sidebar');
  const sidebarRegion = component.getByTestId('token-usage-test-width');
  const workspaceContent = component.getByTestId('workspace-content');
  const shell = component.getByTestId('workspace-token-usage');
  const disclosure = component.getByTestId('token-usage-disclosure');

  const [closedBox, disclosureBox, sidebarBox, sidebarRegionBox, contentBox, summaryMetrics] =
    await Promise.all([
      shell.boundingBox(),
      disclosure.boundingBox(),
      sidebar.boundingBox(),
      sidebarRegion.boundingBox(),
      workspaceContent.boundingBox(),
      disclosure.evaluate((element) => {
        const tokenLabel = element.querySelector('.summary-token-label')!;
        const processedValue = element.querySelector(
          '[id^="workspace-token-usage-processed-"] > span:not(.sr-only)',
        )!;
        const cache = element.querySelector('[id^="workspace-token-usage-cache-"]')!;
        const style = getComputedStyle(element);
        const tokenRect = tokenLabel.getBoundingClientRect();
        return {
          backgroundColor: style.backgroundColor,
          borderRadius: Number.parseFloat(style.borderRadius),
          borderColor: style.borderColor,
          cacheLeft: cache.getBoundingClientRect().left,
          processedFontSize: Number.parseFloat(getComputedStyle(processedValue).fontSize),
          tokenLabelDisplay: getComputedStyle(tokenLabel).display,
          tokenLabelFontSize: Number.parseFloat(getComputedStyle(tokenLabel).fontSize),
          tokenLabelText: tokenLabel.textContent?.trim(),
          tokenLabelTransform: getComputedStyle(tokenLabel).textTransform,
          tokenRight: tokenRect.right,
        };
      }),
    ]);
  expect(closedBox).not.toBeNull();
  expect(disclosureBox).not.toBeNull();
  expect(sidebarBox).not.toBeNull();
  expect(sidebarRegionBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(sidebarBox!.width).toBeCloseTo(352, 0);
  expect(sidebarRegionBox!.width).toBeCloseTo(304, 0);
  expect(closedBox!.height).toBeLessThanOrEqual(44);
  expect(disclosureBox!.width).toBeCloseTo(304, 0);
  expect(summaryMetrics.borderRadius).toBeGreaterThanOrEqual(6);
  expect(summaryMetrics.borderRadius).toBeLessThanOrEqual(8);
  expect(summaryMetrics).toMatchObject({
    backgroundColor: 'rgb(19, 19, 19)',
    borderColor: 'rgb(30, 30, 30)',
    processedFontSize: 14,
    tokenLabelDisplay: 'none',
    tokenLabelFontSize: 10,
    tokenLabelText: 'Tokens',
    tokenLabelTransform: 'uppercase',
  });

  await disclosure.click();
  const agentSection = component.getByTestId('token-usage-by-agent');
  const modelSection = component.getByTestId('token-usage-by-model');
  const details = component.getByTestId('token-usage-details');
  const composition = details.locator('section').first();
  const compositionRows = details.locator('.composition-row');
  const agentRows = agentSection.getByRole('listitem');
  const modelRows = modelSection.getByRole('listitem');
  const detailsMetrics = await details.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: Number.parseFloat(style.borderRadius),
      position: style.position,
      zIndex: Number.parseInt(style.zIndex, 10),
    };
  });

  await expect(details.getByRole('heading', { name: 'Token composition' })).toBeVisible();
  expect(detailsMetrics.borderRadius).toBeGreaterThanOrEqual(8);
  expect(detailsMetrics.borderRadius).toBeLessThanOrEqual(10);
  expect(detailsMetrics).toMatchObject({
    backgroundColor: 'rgb(19, 19, 19)',
    borderColor: 'rgb(30, 30, 30)',
    position: 'fixed',
    zIndex: 60,
  });
  await expect(details).toContainText('1K processed');
  await expect(compositionRows).toHaveCount(4);
  await expect(compositionRows.nth(0)).toContainText('Cached');
  await expect(compositionRows.nth(1)).toContainText('In');
  await expect(compositionRows.nth(2)).toContainText('Out');
  await expect(compositionRows.nth(3)).toContainText('Reasoning');
  await expect(compositionRows.locator('.composition-metric [aria-hidden="true"]')).toHaveCount(4);
  await expect(agentSection).toBeVisible();
  await expect(modelSection).toBeVisible();
  await expect(agentRows).toHaveCount(2);
  await expect(modelRows).toHaveCount(2);
  await expect(agentRows.nth(0)).toContainText('750 75%');
  await expect(agentRows.nth(1)).toContainText('250 25%');
  await expect(modelRows.nth(0)).toContainText('750 75%');
  await expect(modelRows.nth(1)).toContainText('250 25%');
  await expect(agentRows.locator('[aria-hidden="true"] > [style*="width"]')).toHaveCount(2);
  await expect(modelRows.locator('[aria-hidden="true"] > [style*="width"]')).toHaveCount(2);
  await expect(
    composition.locator('div[aria-hidden="true"]').first().locator(':scope > span').first(),
  ).toHaveClass(/bg-success/);
  expect(
    await composition
      .locator('div[aria-hidden="true"]')
      .first()
      .locator(':scope > span')
      .evaluateAll((segments) =>
        segments.every(
          (segment) =>
            Number.parseFloat(getComputedStyle(segment).minWidth) >= 2 &&
            segment.getBoundingClientRect().width >= 2,
        ),
      ),
  ).toBe(true);

  const [
    detailsBox,
    openSidebarBox,
    openContentBox,
    dimensions,
    pageDimensions,
    desktopRows,
    agentBox,
    modelBox,
    breakdownRows,
  ] = await Promise.all([
    details.boundingBox(),
    sidebar.boundingBox(),
    workspaceContent.boundingBox(),
    shell.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    })),
    page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
    compositionRows.evaluateAll((rows) =>
      rows.map((row) => {
        const box = (selector: string) =>
          row.querySelector(selector)!.getBoundingClientRect().toJSON();
        const swatchElement = row.querySelector('.composition-metric [aria-hidden="true"]')!;
        const metricLabel = row.querySelector('.composition-metric span.truncate')!;
        const valueElement = row.querySelector('.composition-value')!;
        const contextElement = row.querySelector('.composition-context')!;
        return {
          row: row.getBoundingClientRect().toJSON(),
          swatch: swatchElement.getBoundingClientRect().toJSON(),
          swatchRadius: Number.parseFloat(getComputedStyle(swatchElement).borderRadius),
          metric: box('.composition-metric'),
          metricTransform: getComputedStyle(metricLabel).textTransform,
          description: box('.composition-description'),
          value: box('.composition-value'),
          context: box('.composition-context'),
          valueAlign: getComputedStyle(valueElement).textAlign,
          contextAlign: getComputedStyle(contextElement).textAlign,
          descriptionDisplay: getComputedStyle(row.querySelector('.composition-description')!)
            .display,
          contextDisplay: getComputedStyle(row.querySelector('.composition-context')!).display,
        };
      }),
    ),
    agentSection.boundingBox(),
    modelSection.boundingBox(),
    details.locator('.breakdown-section li').evaluateAll((rows) =>
      rows.map((row) => {
        const metadata = row.lastElementChild!;
        const [name, value, context] = Array.from(metadata.children).map((child) =>
          child.getBoundingClientRect().toJSON(),
        );
        return { name, value, context };
      }),
    ),
  ]);

  expect(detailsBox).not.toBeNull();
  expect(detailsBox!.width).toBeCloseTo(452, 0);
  expect(detailsBox!.x).toBeCloseTo(disclosureBox!.x, 0);
  expect(detailsBox!.y).toBeCloseTo(disclosureBox!.y + disclosureBox!.height + 8, 0);
  expect(detailsBox!.width / disclosureBox!.width).toBeCloseTo(1.49, 2);
  expect(openSidebarBox).toEqual(sidebarBox);
  expect(openContentBox).toEqual(contentBox);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(pageDimensions.scrollWidth).toBeLessThanOrEqual(pageDimensions.clientWidth);
  expect(agentBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(Math.abs(agentBox!.y - modelBox!.y)).toBeLessThanOrEqual(1);
  expect(agentBox!.width).toBeCloseTo(modelBox!.width, 0);
  expect(
    desktopRows.every(
      ({
        row,
        swatch,
        swatchRadius,
        metric,
        metricTransform,
        description,
        value,
        context,
        valueAlign,
        contextAlign,
        descriptionDisplay,
        contextDisplay,
      }) =>
        row.height <= 44 &&
        swatch.width > 0 &&
        swatch.height > 0 &&
        Math.abs(swatch.width - swatch.height) <= 1 &&
        swatchRadius === 0 &&
        metricTransform === 'uppercase' &&
        descriptionDisplay !== 'none' &&
        contextDisplay !== 'none' &&
        valueAlign === 'right' &&
        contextAlign === 'right' &&
        Math.max(metric.y, description.y, value.y, context.y) -
          Math.min(metric.y, description.y, value.y, context.y) <=
          1 &&
        metric.x < description.x &&
        description.x < value.x &&
        value.x < context.x,
    ),
  ).toBe(true);
  const valueRightEdges = desktopRows.map(({ value }) => value.x + value.width);
  const contextRightEdges = desktopRows.map(({ context }) => context.x + context.width);
  expect(Math.max(...valueRightEdges) - Math.min(...valueRightEdges)).toBeLessThanOrEqual(1);
  expect(Math.max(...contextRightEdges) - Math.min(...contextRightEdges)).toBeLessThanOrEqual(1);
  expect(
    breakdownRows.every(
      ({ name, value, context }) => name.x < value.x && value.x + value.width <= context.x + 1,
    ),
  ).toBe(true);

  const topmost = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest('[data-testid="token-usage-details"]')
        ?.getAttribute('data-testid'),
    {
      x: Math.max(contentBox!.x + 24, detailsBox!.x + detailsBox!.width - 48),
      y: detailsBox!.y + 24,
    },
  );
  expect(topmost).toBe('token-usage-details');

  await component.update({ props: { theme: 'dark', width: 452 } });
  const [wideSidebarRegion, wideDetails, wideSummaryMetrics] = await Promise.all([
    sidebarRegion.boundingBox(),
    details.boundingBox(),
    disclosure.evaluate((element) => {
      const tokenLabel = element.querySelector('.summary-token-label')!;
      const cache = element.querySelector('[id^="workspace-token-usage-cache-"]')!;
      const tokenRect = tokenLabel.getBoundingClientRect();
      return {
        cacheLeft: cache.getBoundingClientRect().left,
        tokenLabelDisplay: getComputedStyle(tokenLabel).display,
        tokenRight: tokenRect.right,
      };
    }),
  ]);
  expect(wideSidebarRegion!.width).toBeCloseTo(452, 0);
  expect(wideDetails!.width).toBeCloseTo(452, 0);
  expect(wideSummaryMetrics.tokenLabelDisplay).toBe('block');
  expect(wideSummaryMetrics.cacheLeft - wideSummaryMetrics.tokenRight).toBeGreaterThanOrEqual(4);

  await component.update({ props: { theme: 'dark', width: 280 } });
  const [
    narrowSidebarRegion,
    narrowDetails,
    narrowRows,
    narrowAgentBox,
    narrowModelBox,
    longModel,
  ] = await Promise.all([
    sidebarRegion.boundingBox(),
    details.boundingBox(),
    compositionRows.evaluateAll((rows) =>
      rows.map((row) => {
        const box = (selector: string) => row.querySelector(selector)!.getBoundingClientRect();
        const metric = box('.composition-metric');
        const description = box('.composition-description');
        const value = box('.composition-value');
        const context = box('.composition-context');
        return {
          ys: [metric.y, description.y, value.y, context.y],
          valueRight: value.right,
          contextRight: context.right,
          descriptionDisplay: getComputedStyle(row.querySelector('.composition-description')!)
            .display,
          contextDisplay: getComputedStyle(row.querySelector('.composition-context')!).display,
        };
      }),
    ),
    agentSection.boundingBox(),
    modelSection.boundingBox(),
    modelSection
      .locator('[title="provider/this-is-an-extraordinarily-long-model-name-for-truncation"]')
      .evaluate((label) => ({
        clientWidth: label.clientWidth,
        scrollWidth: label.scrollWidth,
        overflow: getComputedStyle(label).overflow,
        textOverflow: getComputedStyle(label).textOverflow,
        whiteSpace: getComputedStyle(label).whiteSpace,
      })),
  ]);
  expect(narrowSidebarRegion!.width).toBeCloseTo(280, 0);
  expect(narrowDetails!.width).toBeCloseTo(452, 0);
  expect(
    narrowRows.every(
      ({ ys, descriptionDisplay, contextDisplay }) =>
        descriptionDisplay !== 'none' &&
        contextDisplay !== 'none' &&
        Math.max(...ys) - Math.min(...ys) <= 1,
    ),
  ).toBe(true);
  expect(
    Math.max(...narrowRows.map(({ valueRight }) => valueRight)) -
      Math.min(...narrowRows.map(({ valueRight }) => valueRight)),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.max(...narrowRows.map(({ contextRight }) => contextRight)) -
      Math.min(...narrowRows.map(({ contextRight }) => contextRight)),
  ).toBeLessThanOrEqual(1);
  expect(narrowAgentBox).not.toBeNull();
  expect(narrowModelBox).not.toBeNull();
  expect(Math.abs(narrowAgentBox!.y - narrowModelBox!.y)).toBeLessThanOrEqual(1);
  expect(narrowAgentBox!.width).toBeCloseTo(narrowModelBox!.width, 0);
  expect(longModel.scrollWidth).toBeGreaterThan(longModel.clientWidth);
  expect(longModel).toMatchObject({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });
});

test('dismisses, repositions, flips, and clamps the overlay without changing workspace geometry', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'dark', width: 304, placement: 'top', side: 'left' },
  });
  const sidebar = component.getByTestId('workspace-sidebar');
  const sidebarScroll = component.getByTestId('workspace-sidebar-scroll');
  const workspaceContent = component.getByTestId('workspace-content');
  const disclosure = component.getByTestId('token-usage-disclosure');

  await disclosure.click();
  let details = component.getByTestId('token-usage-details');
  const beforeScroll = await details.boundingBox();
  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 20 }));
  await expect
    .poll(async () => {
      const [anchor, panel] = await Promise.all([disclosure.boundingBox(), details.boundingBox()]);
      return panel!.y - (anchor!.y + anchor!.height);
    })
    .toBeCloseTo(8, 0);
  const afterScroll = await details.boundingBox();
  expect(afterScroll!.y).toBeLessThan(beforeScroll!.y);

  const contentBox = await workspaceContent.boundingBox();
  await workspaceContent.click({
    position: { x: contentBox!.width - 24, y: contentBox!.height - 24 },
  });
  await expect(details).toHaveCount(0);

  await disclosure.click();
  details = component.getByTestId('token-usage-details');
  await disclosure.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(disclosure).toBeFocused();

  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 0 }));
  await component.update({ props: { placement: 'bottom', side: 'left' } });
  await page.setViewportSize({ width: 700, height: 360 });
  await disclosure.click();
  details = component.getByTestId('token-usage-details');
  let [anchorBox, detailsBox] = await Promise.all([
    disclosure.boundingBox(),
    details.boundingBox(),
  ]);
  expect(detailsBox!.y).toBeGreaterThanOrEqual(8);
  expect(detailsBox!.y + detailsBox!.height).toBeCloseTo(anchorBox!.y - 8, 0);
  expect(detailsBox!.height).toBeLessThanOrEqual(anchorBox!.y - 16);

  await component.update({ props: { placement: 'bottom', side: 'right' } });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await expect
    .poll(async () => {
      const box = await details.boundingBox();
      return box!.x + box!.width;
    })
    .toBeCloseTo(692, 0);
  [anchorBox, detailsBox] = await Promise.all([disclosure.boundingBox(), details.boundingBox()]);
  expect(detailsBox!.x).toBeLessThan(anchorBox!.x);
  expect(detailsBox!.x).toBeGreaterThanOrEqual(8);

  await component.update({ props: { placement: 'top', side: 'left' } });
  await sidebarScroll.evaluate((element) => element.scrollTo({ top: 0 }));
  await page.setViewportSize({ width: 280, height: 520 });
  const compositionRows = details.locator('.composition-row');
  const agentSection = component.getByTestId('token-usage-by-agent');
  const modelSection = component.getByTestId('token-usage-by-model');
  const [summaryBox280, compactBox280, compactRows, agentBox, modelBox, pageDimensions280] =
    await Promise.all([
      disclosure.boundingBox(),
      details.boundingBox(),
      compositionRows.evaluateAll((rows) =>
        rows.map((row) => {
          const metric = row.querySelector('.composition-metric')!.getBoundingClientRect();
          const description = row
            .querySelector('.composition-description')!
            .getBoundingClientRect();
          const value = row.querySelector('.composition-value')!.getBoundingClientRect();
          const context = row.querySelector('.composition-context')!.getBoundingClientRect();
          return { metric, description, value, context };
        }),
      ),
      agentSection.boundingBox(),
      modelSection.boundingBox(),
      page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      })),
    ]);
  expect(summaryBox280!.width).toBeCloseTo(232, 0);
  expect(compactBox280!.width).toBeCloseTo(264, 0);
  expect(compactBox280!.x).toBeCloseTo(8, 0);
  expect(compactBox280!.x + compactBox280!.width).toBeCloseTo(272, 0);
  expect(pageDimensions280.scrollWidth).toBeLessThanOrEqual(pageDimensions280.clientWidth);
  expect(
    compactRows.every(
      ({ metric, description, value, context }) =>
        Math.abs(metric.y - value.y) <= 1 &&
        Math.abs(value.y - context.y) <= 1 &&
        description.y > metric.y,
    ),
  ).toBe(true);
  expect(modelBox!.y).toBeGreaterThanOrEqual(agentBox!.y + agentBox!.height - 1);

  await page.setViewportSize({ width: 248, height: 480 });
  const [summaryBox248, compactBox248, pageDimensions248] = await Promise.all([
    disclosure.boundingBox(),
    details.boundingBox(),
    page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    })),
  ]);
  expect(summaryBox248!.width).toBeCloseTo(200, 0);
  expect(compactBox248!.width).toBeCloseTo(232, 0);
  expect(compactBox248!.x).toBeCloseTo(8, 0);
  expect(compactBox248!.x + compactBox248!.width).toBeCloseTo(240, 0);
  expect(pageDimensions248.scrollWidth).toBeLessThanOrEqual(pageDimensions248.clientWidth);
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(248, 0);
});
