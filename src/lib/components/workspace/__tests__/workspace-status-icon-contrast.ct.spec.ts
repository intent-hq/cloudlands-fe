import { expect, test } from '@playwright/experimental-ct-svelte';
import WorkspaceStatusIconContrastHost from './WorkspaceStatusIconContrastHost.svelte';

test('keeps every running workspace dot solid without changing geometry or other modes', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceStatusIconContrastHost, {
    props: { theme: 'light', zoom: 1, width: 'wide' },
  });
  const runningDots = component.locator(
    '[data-workspace-status="in_progress"] [data-workspace-status-dot]',
  );
  const idleDots = component.locator('[data-workspace-status="idle"] [data-workspace-status-dot]');

  await expect(runningDots).toHaveCount(3);
  await expect(idleDots).toHaveCount(2);

  for (const theme of ['light', 'dark'] as const) {
    for (const width of ['narrow', 'wide'] as const) {
      for (const zoom of [1, 2]) {
        for (const reducedMotion of ['no-preference', 'reduce'] as const) {
          await page.emulateMedia({ reducedMotion });
          await component.update({ props: { theme, zoom, width } });
          await expect(component).toHaveAttribute('data-theme', theme);
          await expect(component).toHaveAttribute('data-width', width);
          await expect(component).toHaveCSS('width', width === 'narrow' ? '128px' : '320px');
          await expect
            .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
            .toBe(theme === 'dark');

          for (const running of await runningDots.all()) {
            const runningStyle = await running.evaluate((element) => {
              const style = getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return {
                animationName: style.animationName,
                backgroundColor: style.backgroundColor,
                borderWidth: style.borderWidth,
                boxShadow: style.boxShadow,
                color: style.color,
                height: style.height,
                outlineStyle: style.outlineStyle,
                renderedHeight: bounds.height,
                renderedWidth: bounds.width,
                width: style.width,
              };
            });

            expect(runningStyle.backgroundColor).toBe(runningStyle.color);
            expect(runningStyle.borderWidth).toBe('0px');
            expect(runningStyle.boxShadow).toBe('none');
            expect(runningStyle.outlineStyle).toBe('none');
            expect(runningStyle.width).toBe('8px');
            expect(runningStyle.height).toBe('8px');
            expect(runningStyle.renderedWidth).toBe(8 * zoom);
            expect(runningStyle.renderedHeight).toBe(8 * zoom);
            expect(runningStyle.animationName).toBe('none');
          }
          for (const idle of await idleDots.all()) {
            await expect(idle).toHaveCSS('width', '8px');
            await expect(idle).toHaveCSS('height', '8px');
            await expect(idle).toHaveCSS('box-shadow', 'none');
          }
        }
      }
    }
  }

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await component.update({ props: { theme: 'light', zoom: 1, width: 'narrow' } });
  for (const running of await runningDots.all()) {
    await expect(running).toHaveCSS('border-width', '0px');
    await expect(running).toHaveCSS('box-shadow', 'none');
    await expect(running).toHaveCSS('outline-style', 'none');
    expect(await running.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
  }
  for (const idle of await idleDots.all()) {
    await expect(idle).toHaveCSS('box-shadow', 'none');
  }
});
