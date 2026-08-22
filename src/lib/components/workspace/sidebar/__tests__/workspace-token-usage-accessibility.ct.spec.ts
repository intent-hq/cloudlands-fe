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

test('exposes compact values and keeps cache text readable in both themes', async ({ mount }) => {
  const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
    props: { theme: 'light' },
  });
  const disclosure = component.locator('button[aria-controls^="workspace-token-usage-details-"]');

  await expect(disclosure).toHaveAccessibleDescription('1K processed 70% Cached');
  await disclosure.click();
  await expect(disclosure).toHaveAccessibleName('Collapse token usage details');
  await expect(disclosure).toHaveAccessibleDescription('1K processed 70% Cached');

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme } });
    await expect(component).toHaveAttribute('data-theme', theme);
    const colors = await component
      .locator('#workspace-token-usage-cache-token-usage-accessibility-ct > span:first-child')
      .evaluate((element) => {
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
        const backgrounds: string[] = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          backgrounds.push(getComputedStyle(node).backgroundColor);
        }
        return {
          foreground: paint([getComputedStyle(element).color]),
          background: paint(backgrounds.reverse()),
        };
      });

    expect(contrastRatio(colors.foreground, colors.background), theme).toBeGreaterThanOrEqual(4.5);
  }
});
