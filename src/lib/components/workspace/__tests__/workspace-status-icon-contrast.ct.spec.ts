import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import WorkspaceStatusIconContrastHost from './WorkspaceStatusIconContrastHost.svelte';

const tabs = ['active', 'inactive'] as const;

function dot(host: Locator, tab: (typeof tabs)[number], status: 'in_progress' | 'idle'): Locator {
  return host.locator(
    `[data-workspace-tab-kind="${tab}"] [data-status="${status}"] [data-workspace-status-dot]`,
  );
}

test('keeps the running-dot light ring semantic without changing geometry or other modes', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceStatusIconContrastHost, {
    props: { theme: 'light', zoom: 1 },
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { theme, zoom } });
      await expect(component).toHaveAttribute('data-theme', theme);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(theme === 'dark');

      const semanticBackground = await component.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      for (const tab of tabs) {
        const running = dot(component, tab, 'in_progress');
        const idle = dot(component, tab, 'idle');
        const runningStyle = await running.evaluate((element) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return {
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
        expect(runningStyle.width).toBe('8px');
        expect(runningStyle.height).toBe('8px');
        expect(runningStyle.renderedWidth).toBe(8 * zoom);
        expect(runningStyle.renderedHeight).toBe(8 * zoom);
        if (theme === 'light') {
          expect(runningStyle.boxShadow).toContain('inset');
          expect(runningStyle.boxShadow).toContain('1px');
          expect(runningStyle.boxShadow).toContain(semanticBackground);
        } else {
          expect(runningStyle.boxShadow).toBe('none');
        }
        await expect(idle).toHaveCSS('box-shadow', 'none');
        await expect(idle).toHaveCSS('width', '8px');
        await expect(idle).toHaveCSS('height', '8px');
      }
    }
  }

  await page.emulateMedia({ forcedColors: 'active' });
  await component.update({ props: { theme: 'light', zoom: 1 } });
  for (const tab of tabs) {
    await expect(dot(component, tab, 'in_progress')).toHaveCSS('box-shadow', 'none');
    await expect(dot(component, tab, 'idle')).toHaveCSS('box-shadow', 'none');
  }
});
