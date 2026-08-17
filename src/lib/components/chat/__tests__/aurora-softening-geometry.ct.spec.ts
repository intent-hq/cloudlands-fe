import { expect, test } from '@playwright/experimental-ct-svelte';
import AuroraSofteningGeometryHost from './AuroraSofteningGeometryHost.svelte';

for (const state of [
  { name: 'wide light', dark: false, width: 720, zoom: 1, longPrompt: false },
  { name: 'narrow dark at 200% zoom', dark: true, width: 180, zoom: 2, longPrompt: true },
]) {
  test(`keeps the prompt sharp over progressive Aurora softening at ${state.name}`, async ({
    mount,
  }) => {
    const component = await mount(AuroraSofteningGeometryHost, { props: state });
    const host = component.getByTestId('aurora-geometry-host');
    const layer = component.getByTestId('aurora-softening-layer');
    const prompt = component.getByTestId('sharp-prompt-layer');
    const input = component.getByTestId('prompt-input');

    const styles = await Promise.all(
      [layer, prompt].map((locator) =>
        locator.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            backdropFilter: style.backdropFilter,
            filter: style.filter,
            maskImage: style.maskImage,
            pointerEvents: style.pointerEvents,
            zIndex: style.zIndex,
          };
        }),
      ),
    );

    expect(styles[0].backdropFilter).toContain('blur(18px)');
    expect(styles[0].maskImage).toContain('linear-gradient');
    expect(styles[0].pointerEvents).toBe('none');
    expect(Number(styles[0].zIndex)).toBeLessThan(Number(styles[1].zIndex));
    expect(styles[1].filter).toBe('none');
    expect(styles[1].backdropFilter).toBe('none');

    await input.focus();
    await input.evaluate((node) => (node as HTMLTextAreaElement).setSelectionRange(2, 12));
    await expect(input).toBeFocused();
    expect(await input.evaluate((node) => (node as HTMLTextAreaElement).selectionStart)).toBe(2);
    expect(await host.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  });
}

test('keeps the softened layer static with reduced motion', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(AuroraSofteningGeometryHost);
  const layer = component.getByTestId('aurora-softening-layer');

  expect(
    await layer.evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.animationName, style.transitionDuration];
    }),
  ).toEqual(['none', '0s']);
});
