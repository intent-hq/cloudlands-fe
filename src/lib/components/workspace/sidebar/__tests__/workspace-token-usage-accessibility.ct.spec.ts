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

test('keeps the full reference table at workspace and 280 px widths', async ({ mount }) => {
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { width: 452 },
  });
  const shell = component.getByTestId('workspace-token-usage');
  const disclosure = component.getByTestId('token-usage-disclosure');

  const [closedBox, disclosureBox] = await Promise.all([
    shell.boundingBox(),
    disclosure.boundingBox(),
  ]);
  expect(closedBox).not.toBeNull();
  expect(disclosureBox).not.toBeNull();
  expect(closedBox!.height).toBeLessThanOrEqual(44);
  expect(disclosureBox!.width).toBeCloseTo(352, 0);

  await disclosure.click();
  const agentSection = component.getByTestId('token-usage-by-agent');
  const modelSection = component.getByTestId('token-usage-by-model');
  const details = component.getByTestId('token-usage-details');
  const composition = details.locator('section').first();
  const compositionRows = details.locator('.composition-row');
  const agentRows = agentSection.getByRole('listitem');
  const modelRows = modelSection.getByRole('listitem');

  await expect(details.getByRole('heading', { name: 'Token composition' })).toBeVisible();
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

  const [detailsBox, dimensions, desktopRows, agentBox, modelBox, breakdownRows] =
    await Promise.all([
      details.boundingBox(),
      shell.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
      compositionRows.evaluateAll((rows) =>
        rows.map((row) => {
          const box = (selector: string) =>
            row.querySelector(selector)!.getBoundingClientRect().toJSON();
          const valueElement = row.querySelector('.composition-value')!;
          const contextElement = row.querySelector('.composition-context')!;
          return {
            row: row.getBoundingClientRect().toJSON(),
            swatch: row
              .querySelector('.composition-metric [aria-hidden="true"]')!
              .getBoundingClientRect()
              .toJSON(),
            metric: box('.composition-metric'),
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
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(agentBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(Math.abs(agentBox!.y - modelBox!.y)).toBeLessThanOrEqual(1);
  expect(agentBox!.width).toBeCloseTo(modelBox!.width, 0);
  expect(
    desktopRows.every(
      ({
        row,
        swatch,
        metric,
        description,
        value,
        context,
        valueAlign,
        contextAlign,
        descriptionDisplay,
        contextDisplay,
      }) =>
        row.height <= 40 &&
        swatch.width > 0 &&
        swatch.height > 0 &&
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

  await component.update({ props: { width: 280 } });
  const [narrowDimensions, narrowRows, narrowAgentBox, narrowModelBox, longModel] =
    await Promise.all([
      shell.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
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
  expect(narrowDimensions.clientWidth).toBe(280);
  expect(narrowDimensions.scrollWidth).toBeLessThanOrEqual(narrowDimensions.clientWidth);
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

  await component.update({ props: { width: 248 } });
  const [compactDimensions, compactRows, compactAgentBox, compactModelBox] = await Promise.all([
    shell.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    })),
    compositionRows.evaluateAll((rows) =>
      rows.map((row) => {
        const metric = row.querySelector('.composition-metric')!.getBoundingClientRect();
        const description = row.querySelector('.composition-description')!.getBoundingClientRect();
        const value = row.querySelector('.composition-value')!.getBoundingClientRect();
        const context = row.querySelector('.composition-context')!.getBoundingClientRect();
        return { metric, description, value, context };
      }),
    ),
    agentSection.boundingBox(),
    modelSection.boundingBox(),
  ]);
  expect(compactDimensions.scrollWidth).toBeLessThanOrEqual(compactDimensions.clientWidth);
  expect(
    compactRows.every(
      ({ metric, description, value, context }) =>
        Math.abs(metric.y - value.y) <= 1 &&
        Math.abs(value.y - context.y) <= 1 &&
        description.y > metric.y,
    ),
  ).toBe(true);
  expect(compactAgentBox).not.toBeNull();
  expect(compactModelBox).not.toBeNull();
  expect(compactModelBox!.y).toBeGreaterThanOrEqual(
    compactAgentBox!.y + compactAgentBox!.height - 1,
  );
});
