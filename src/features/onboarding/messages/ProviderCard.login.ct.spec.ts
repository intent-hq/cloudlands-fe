import { expect, test } from '../../../test/ct-test';
import ProviderCard from './ProviderCard.svelte';

for (const theme of ['light', 'dark']) {
  test(`Claude login has an opaque, readable button on the ${theme} provider card`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 520 });
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
    }, theme);
    const card = await mount(ProviderCard, {
      props: {
        provider: {
          id: 'claude-code',
          name: 'Anthropic Claude Code',
          available: true,
          authenticated: false,
          statusLoading: false,
          authDetails: undefined,
          docsUrl: 'https://code.claude.com/docs',
          installCommand: '',
          loginCommandHint: 'claude auth login',
          hasNpxFallback: true,
        },
        brand: { color1: '#D97757', color2: '#D97757' },
        npxStatus: null,
        onSelect: () => {},
      },
    });
    const login = card.getByRole('button', { name: 'Log in', exact: true });
    await expect(login).toBeVisible();
    const contrast = await login.evaluate((button) => {
      const style = getComputedStyle(button);
      const surface = button.querySelector<HTMLElement>('[data-slot="button-surface"]');
      if (!surface) throw new Error('button surface slot missing');
      const surfaceStyle = getComputedStyle(surface);
      const buttonBox = button.getBoundingClientRect();
      const surfaceBox = surface.getBoundingClientRect();
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
      const background = rgba(surfaceStyle.backgroundColor);
      const foreground = rgba(style.color);
      const light = Math.max(luminance(background), luminance(foreground));
      const dark = Math.min(luminance(background), luminance(foreground));
      return {
        alpha: background[3],
        ratio: (light + 0.05) / (dark + 0.05),
        surfaceCoversButton:
          Math.abs(surfaceBox.left - buttonBox.left) < 1 &&
          Math.abs(surfaceBox.top - buttonBox.top) < 1 &&
          Math.abs(surfaceBox.width - buttonBox.width) < 1 &&
          Math.abs(surfaceBox.height - buttonBox.height) < 1,
      };
    });
    expect(contrast.surfaceCoversButton).toBe(true);
    expect(contrast.alpha).toBe(255);
    expect(contrast.ratio).toBeGreaterThanOrEqual(4.5);
    await card.screenshot({
      path: testInfo.outputPath(`claude-login-${theme}.png`),
      animations: 'disabled',
    });
  });
}
