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

test('exposes compact values and keeps summary text readable on hover', async ({ mount }) => {
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

test('fits real workspace widths without becoming an oversized vertical card', async ({
  mount,
}) => {
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { width: 280 },
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
  expect(disclosureBox!.width).toBeCloseTo(280, 0);

  await disclosure.click();
  const agentSection = component.getByTestId('token-usage-by-agent');
  const modelSection = component.getByTestId('token-usage-by-model');
  const details = component.getByTestId('token-usage-details');
  const compositionRows = details.locator('.composition-row');
  await expect(compositionRows).toHaveCount(4);
  const [agentBox, modelBox, rowBoxes, dimensions, narrowComposition, longModel] =
    await Promise.all([
      agentSection.boundingBox(),
      modelSection.boundingBox(),
      agentSection
        .locator('li')
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)),
      shell.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      })),
      compositionRows.first().evaluate((row) => {
        const box = (selector: string) =>
          row.querySelector(selector)!.getBoundingClientRect().toJSON();
        return {
          metric: box('.composition-metric'),
          description: box('.composition-description'),
          value: box('.composition-value'),
          context: box('.composition-context'),
        };
      }),
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

  expect(agentBox).not.toBeNull();
  expect(modelBox).not.toBeNull();
  expect(modelBox!.y).toBeGreaterThanOrEqual(agentBox!.y + agentBox!.height - 1);
  expect(Math.max(...rowBoxes)).toBeLessThanOrEqual(32);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(narrowComposition.description.y).toBeGreaterThan(narrowComposition.metric.y);
  expect(narrowComposition.metric.y).toBeCloseTo(narrowComposition.value.y, 0);
  expect(narrowComposition.value.y).toBeCloseTo(narrowComposition.context.y, 0);
  expect(longModel.scrollWidth).toBeGreaterThan(longModel.clientWidth);
  expect(longModel).toMatchObject({
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  });

  await component.update({ props: { width: 452 } });
  const [wideShellBox, detailsBox, wideAgentBox, wideModelBox, wideComposition] = await Promise.all(
    [
      shell.boundingBox(),
      details.boundingBox(),
      agentSection.boundingBox(),
      modelSection.boundingBox(),
      compositionRows.first().evaluate((row) => {
        const box = (selector: string) =>
          row.querySelector(selector)!.getBoundingClientRect().toJSON();
        return {
          metric: box('.composition-metric'),
          description: box('.composition-description'),
          value: box('.composition-value'),
          context: box('.composition-context'),
        };
      }),
    ],
  );
  expect(wideShellBox).not.toBeNull();
  expect(detailsBox).not.toBeNull();
  expect(wideAgentBox).not.toBeNull();
  expect(wideModelBox).not.toBeNull();
  expect(wideShellBox!.height).toBeLessThan(wideShellBox!.width);
  expect(detailsBox!.width).toBeCloseTo(452, 0);
  expect(Math.abs(wideAgentBox!.y - wideModelBox!.y)).toBeLessThanOrEqual(1);
  expect(wideModelBox!.x).toBeGreaterThan(wideAgentBox!.x);
  expect(wideAgentBox!.width).toBeCloseTo(wideModelBox!.width, 0);
  expect(wideComposition.metric.y).toBeCloseTo(wideComposition.description.y, 0);
  expect(wideComposition.description.y).toBeCloseTo(wideComposition.value.y, 0);
  expect(wideComposition.value.y).toBeCloseTo(wideComposition.context.y, 0);
  expect(wideComposition.metric.x).toBeLessThan(wideComposition.description.x);
  expect(wideComposition.description.x).toBeLessThan(wideComposition.value.x);
  expect(wideComposition.value.x).toBeLessThan(wideComposition.context.x);
});
