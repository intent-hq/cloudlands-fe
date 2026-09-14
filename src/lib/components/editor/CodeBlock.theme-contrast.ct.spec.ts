import { expect, test } from '@playwright/experimental-ct-svelte';
import CodeBlock from './CodeBlock.svelte';

// The CT store bootstrap keeps the Redux theme at its default, so the root
// `.dark` class is the only theme signal — the same situation as the sandbox
// and the pre-saga startup window (intent-hq/intent#4647).
const CODE = "const gap: number = 10;\nconst label = 'x';";

for (const theme of ['light', 'dark'] as const) {
  test(`code-block tokens stay readable on the ${theme} surface`, async ({ mount, page }) => {
    await page.setViewportSize({ width: 640, height: 320 });
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    const block = await mount(CodeBlock, { props: { code: CODE, language: 'typescript' } });
    const tokens = block.locator('code [class*="hljs-"]');
    await expect(tokens.first()).toBeVisible();

    const samples = await block.evaluate((container) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const rgba = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const luminance = (color: number[]) => {
        const linear = color.slice(0, 3).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
      };
      const pre = container.querySelector('pre')!;
      const surface = rgba(getComputedStyle(pre).backgroundColor);
      const ratio = (color: string) => {
        const fg = luminance(rgba(color));
        const bg = luminance(surface);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      };
      const byToken = new Map<string, number>();
      byToken.set('plain', ratio(getComputedStyle(pre).color));
      for (const span of container.querySelectorAll<HTMLElement>('code [class*="hljs-"]')) {
        const token = [...span.classList].find((name) => name.startsWith('hljs-'));
        if (token && !byToken.has(token)) byToken.set(token, ratio(getComputedStyle(span).color));
      }
      return { surfaceAlpha: surface[3], ratios: Object.fromEntries(byToken) };
    });

    expect(samples.surfaceAlpha).toBe(255);
    expect(Object.keys(samples.ratios).length).toBeGreaterThan(2);
    for (const [token, ratio] of Object.entries(samples.ratios)) {
      expect(ratio, `${token} contrast on the ${theme} code surface`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
