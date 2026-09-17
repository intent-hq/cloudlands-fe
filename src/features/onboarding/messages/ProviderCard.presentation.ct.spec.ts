import { expect, test } from '@playwright/experimental-ct-svelte';
import Preview from './provider-card.preview.svelte';
import ProviderCard from './ProviderCard.svelte';

const states = [
  { name: 'Claude login', id: 'claude-code', light: false, authenticated: false, selected: false },
  { name: 'Claude selected', id: 'claude-code', light: false, authenticated: true, selected: true },
  { name: 'Grok connected', id: 'grok', light: false, authenticated: true, selected: false },
  { name: 'Codex connected', id: 'codex', light: true, authenticated: true, selected: false },
];

for (const theme of ['light', 'dark']) {
  for (const state of states) {
    test(`${state.name} preserves brand foreground and contained title in ${theme}`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 340, height: 440 });
      await page.evaluate(
        (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
        theme,
      );
      const title = 'A very long provider name that must truncate';
      const component = await mount(Preview, {
        props: {
          provider: {
            id: state.id,
            name: title,
            available: true,
            authenticated: state.authenticated,
            statusLoading: false,
            authDetails: undefined,
            docsUrl: 'https://example.com/docs',
            installCommand: '',
            hasNpxFallback: false,
          },
          brand: state.light
            ? { color1: '#CBE6FF', color2: '#DDBEFC', isLight: true }
            : state.id === 'grok'
              ? { color1: '#000000', color2: '#252525' }
              : { color1: '#D97757', color2: '#D97757' },
          selected: state.selected,
          npxStatus: null,
          onSelect: () => {},
        },
      });
      const card = component.locator('div[role=button]');
      const name = component.getByRole('button', { name: title, exact: true });
      await expect(name).toBeVisible();
      const metrics = await card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const artwork = element
          .querySelector('[data-testid=provider-card-artwork]')!
          .getBoundingClientRect();
        const buttons = Array.from(element.querySelectorAll('button'));
        const name = buttons[0]!;
        const label = name.querySelector<HTMLElement>('[data-slot=button-label]')!;
        const icon = element.querySelector('svg')!;
        const docs = buttons[1]!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          color: style.color,
          titleColor: getComputedStyle(name).color,
          iconColor: getComputedStyle(icon).color,
          iconWidth: icon.getBoundingClientRect().width,
          artworkInset: artwork.top - box.top,
          artworkBottom: artwork.bottom - box.bottom,
          titleInset: label.getBoundingClientRect().left - box.left,
          contentInset: parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
          docsRight: docs.right,
          contentRight: box.right - parseFloat(style.paddingRight),
          overflowing: label.scrollWidth > label.clientWidth,
          ellipsis: getComputedStyle(label).textOverflow,
        };
      });
      expect(metrics.titleColor).toBe(metrics.color);
      expect(metrics.iconColor).toBe(metrics.color);
      expect(metrics.iconWidth).toBe(32);
      if (!state.light) expect(metrics.color).toBe('rgb(255, 255, 255)');
      expect(Math.abs(metrics.artworkInset)).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.artworkBottom)).toBeLessThanOrEqual(1);
      expect(metrics.titleInset).toBeCloseTo(metrics.contentInset, 0);
      expect(metrics.docsRight).toBeLessThanOrEqual(metrics.contentRight);
      expect(metrics.overflowing).toBe(true);
      expect(metrics.ellipsis).toBe('ellipsis');
      await expect(component.getByTestId('provider-card-selected-banner')).toHaveCount(
        state.selected ? 1 : 0,
      );
      await component.screenshot({
        path: testInfo.outputPath('provider.png'),
        animations: 'disabled',
      });
    });
  }
}

test('keyboard activation of the ready card selects it', async ({ mount, page }) => {
  const selections: string[] = [];
  const component = await mount(ProviderCard, {
    props: {
      provider: {
        id: 'grok',
        name: 'Grok',
        available: true,
        authenticated: true,
        statusLoading: false,
        authDetails: undefined,
        docsUrl: '',
        installCommand: '',
        hasNpxFallback: false,
      },
      brand: { color1: '#000000', color2: '#252525' },
      npxStatus: null,
      onSelect: (id) => selections.push(id),
    },
  });
  const card = component.locator('[role=button]');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => selections).toEqual(['grok']);
});
