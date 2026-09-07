import { expect, test } from '@playwright/experimental-ct-svelte';
import MarkdownMathPreview from '../markdown-math.preview.svelte';

function contrastRatio(foreground: number[], background: number[]): number {
  const luminance = (channels: number[]) => {
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('reconciles a lightweight stream into accessible completed chat math', async ({ mount }) => {
  const component = await mount(MarkdownMathPreview, { props: { isStreaming: true } });
  const chat = component.getByTestId('completed-chat-math');
  await expect(chat).toContainText('$e^{i\\pi}+1=0$');
  await expect(chat.locator('math')).toHaveCount(0);

  await component.update({ props: { isStreaming: false } });
  await expect(chat.locator('math')).toHaveCount(2);
  await expect(chat.locator('[aria-hidden="true"]')).toHaveCount(2);
});

for (const { theme, width } of [
  { theme: 'light', width: 720 },
  { theme: 'dark', width: 272 },
] as const) {
  test(`keeps local math readable in ${theme} at ${width}px`, async ({ mount, page }) => {
    const component = await mount(MarkdownMathPreview, { props: { dense: width < 300 } });
    await component.evaluate((element, className) => element.classList.add(className), theme);
    await component.evaluate((element, nextWidth) => {
      (element as HTMLElement).style.width = `${nextWidth}px`;
    }, width);

    const note = component.getByTestId('read-only-markdown-math');
    await expect(note.locator('math')).toHaveCount(6);
    await expect(note.locator('code')).toContainText('$not-math$');
    await expect(note).toContainText('Costs $5 and $10');

    const measurements = await note.evaluate((element) => {
      const visual = element.querySelector<HTMLElement>('.katex-html')!;
      const display = element.querySelector<HTMLElement>('.math-display')!;
      const color = (value: string) =>
        value
          .match(/[0-9.]+/g)!
          .slice(0, 3)
          .map(Number);
      return {
        foreground: color(getComputedStyle(visual).color),
        background: color(getComputedStyle(element).backgroundColor),
        contained: element.scrollWidth <= element.clientWidth,
        displayHeightRatio:
          display.getBoundingClientRect().height / parseFloat(getComputedStyle(display).fontSize),
        displayScrollable: display.scrollWidth > display.clientWidth,
        overflowX: getComputedStyle(display).overflowX,
      };
    });
    expect(contrastRatio(measurements.foreground, measurements.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(measurements.contained).toBe(true);
    expect(measurements.displayHeightRatio).toBeGreaterThan(2);
    if (width < 300) expect(measurements.displayScrollable).toBe(true);
    expect(measurements.overflowX).toBe('auto');

    const fontResources = await page.evaluate(async () => {
      await document.fonts.load('16px KaTeX_Main');
      return performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => name.includes('KaTeX_Main'));
    });
    expect(fontResources.length).toBeGreaterThan(0);
    expect(fontResources.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(
      true,
    );
  });
}
