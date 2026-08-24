import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import WorkspaceStatusIconContrastHost from './WorkspaceStatusIconContrastHost.svelte';

const tabs = ['active', 'inactive'] as const;

function dot(host: Locator, tab: (typeof tabs)[number], status: 'in_progress' | 'idle'): Locator {
  return host.locator(
    `[data-workspace-tab-kind="${tab}"] [data-status="${status}"] [data-workspace-status-dot]`,
  );
}

test('keeps workspace-tab running dots solid without changing geometry or other modes', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceStatusIconContrastHost, {
    props: { theme: 'light', zoom: 1, width: 'wide' },
  });

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

          for (const tab of tabs) {
            const running = dot(component, tab, 'in_progress');
            const idle = dot(component, tab, 'idle');
            const runningStyle = await running.evaluate((element) => {
              const style = getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return {
                animationName: style.animationName,
                backgroundColor: style.backgroundColor,
                boxShadow: style.boxShadow,
                color: style.color,
                height: style.height,
                renderedHeight: bounds.height,
                renderedWidth: bounds.width,
                width: style.width,
              };
            });

            expect(runningStyle.backgroundColor).toBe(runningStyle.color);
            expect(runningStyle.boxShadow).toBe('none');
            expect(runningStyle.width).toBe('8px');
            expect(runningStyle.height).toBe('8px');
            expect(runningStyle.renderedWidth).toBe(8 * zoom);
            expect(runningStyle.renderedHeight).toBe(8 * zoom);
            expect(runningStyle.animationName).toBe('none');
            await expect(idle).toHaveCSS('box-shadow', 'none');
            await expect(idle).toHaveCSS('width', '8px');
            await expect(idle).toHaveCSS('height', '8px');
          }
        }
      }
    }
  }

  const nonTabRunning = component.locator('[data-non-tab-status] [data-workspace-status-dot]');
  await component.update({ props: { theme: 'light', zoom: 1, width: 'wide' } });
  await expect(nonTabRunning).toHaveCSS('box-shadow', /1px inset$/);
  await component.update({ props: { theme: 'dark', zoom: 1, width: 'wide' } });
  await expect(nonTabRunning).toHaveCSS('box-shadow', 'none');

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await component.update({ props: { theme: 'light', zoom: 1, width: 'narrow' } });
  for (const tab of tabs) {
    const running = dot(component, tab, 'in_progress');
    await expect(running).toHaveCSS('box-shadow', 'none');
    expect(await running.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    await expect(dot(component, tab, 'idle')).toHaveCSS('box-shadow', 'none');
  }
  await expect(nonTabRunning).toHaveCSS('box-shadow', 'none');
});
