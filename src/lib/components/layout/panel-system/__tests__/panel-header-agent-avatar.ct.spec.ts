import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderAvatarHost from './mocks/PanelHeaderAvatarHost.svelte';

const states = [
  { width: 520, focused: true, attention: false, longTitle: false },
  { width: 520, focused: false, attention: true, longTitle: false },
  { width: 220, focused: true, attention: false, longTitle: true },
  { width: 220, focused: false, attention: true, longTitle: true },
] as const;

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2] as const) {
    test(`matches the Notes header icon in ${theme} at ${zoom * 100}% zoom`, async ({ mount }) => {
      const component = await mount(PanelHeaderAvatarHost, {
        props: { theme, zoom, activeAgent: 'a', ...states[0] },
      });
      const agentCase = component.locator('[data-panel-header-case="agent"]');
      const resourceCase = component.locator('[data-panel-header-case="resource"]');
      const agentSlot = agentCase.getByTestId('panel-header-agent-avatar-slot');
      const avatar = agentSlot.locator('svg[data-agent-avatar]');
      const resourceSlot = resourceCase.locator('[data-panel-header-leading-surface]');
      const resourceTile = resourceSlot.locator('[data-resource-icon-tile]');

      await expect(avatar).toHaveCount(1);
      await expect(avatar).toHaveAttribute('data-avatar-variant', 'emphasized');
      await expect(resourceTile).toHaveAttribute('data-resource-icon-variant', 'emphasized');
      await expect(agentSlot.locator('[data-panel-agent-chat-glyph]')).toHaveCount(0);
      await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
      const initialDesign = await avatar.getAttribute('data-avatar-design');

      for (const state of states) {
        await component.update({ props: { theme, zoom, activeAgent: 'a', ...state } });
        const geometry = await component.evaluate((root, selectedZoom) => {
          const measure = (caseName: 'agent' | 'resource') => {
            const panelCase = root.querySelector<HTMLElement>(
              `[data-panel-header-case="${caseName}"]`,
            )!;
            const header = panelCase.querySelector<HTMLElement>('[data-panel-content-header]')!;
            const slot = panelCase.querySelector<HTMLElement>(
              '[data-panel-header-leading-surface]',
            )!;
            const surface = slot.querySelector<HTMLElement>(
              caseName === 'agent' ? '[data-agent-avatar]' : '[data-resource-icon-tile]',
            )!;
            const art =
              caseName === 'agent'
                ? surface
                : surface.querySelector<HTMLElement>('[data-resource-icon-glyph]')!;
            const title = panelCase.querySelector<HTMLElement>('[data-panel-header-title]')!;
            const headerRect = header.getBoundingClientRect();
            const slotRect = slot.getBoundingClientRect();
            const surfaceRect = surface.getBoundingClientRect();
            const artRect = art.getBoundingClientRect();
            const titleRect = title.getBoundingClientRect();
            const titleText = title.querySelector<HTMLElement>('span') ?? title;
            const surfaceStyle = getComputedStyle(surface);
            const scale = selectedZoom;
            const artWidth =
              caseName === 'agent'
                ? surfaceRect.width / scale -
                  Number.parseFloat(surfaceStyle.paddingLeft) -
                  Number.parseFloat(surfaceStyle.paddingRight)
                : artRect.width / scale;
            const artHeight =
              caseName === 'agent'
                ? surfaceRect.height / scale -
                  Number.parseFloat(surfaceStyle.paddingTop) -
                  Number.parseFloat(surfaceStyle.paddingBottom)
                : artRect.height / scale;
            return {
              headerHeight: headerRect.height / scale,
              slotWidth: slotRect.width / scale,
              slotHeight: slotRect.height / scale,
              surfaceWidth: surfaceRect.width / scale,
              surfaceHeight: surfaceRect.height / scale,
              artWidth,
              artHeight,
              surfaceLeft: (surfaceRect.left - headerRect.left) / scale,
              surfaceTop: (surfaceRect.top - headerRect.top) / scale,
              titleLeft: (titleRect.left - headerRect.left) / scale,
              titleGap: (titleRect.left - surfaceRect.right) / scale,
              titleCenterDelta:
                Math.abs(
                  titleRect.top + titleRect.height / 2 - (headerRect.top + headerRect.height / 2),
                ) / scale,
              clipped:
                surfaceRect.left < slotRect.left ||
                surfaceRect.right > slotRect.right ||
                surfaceRect.top < slotRect.top ||
                surfaceRect.bottom > slotRect.bottom,
              focused: header.hasAttribute('data-column-focused'),
              attention: panelCase.querySelectorAll('[data-attention]').length,
              titleColor: getComputedStyle(titleText).color,
              titleClipped: titleText.scrollWidth > titleText.clientWidth,
            };
          };
          return { agent: measure('agent'), resource: measure('resource') };
        }, zoom);

        expect(geometry.agent).toEqual({
          ...geometry.resource,
          artWidth: 20,
          artHeight: 20,
        });
        expect(geometry.agent).toMatchObject({
          slotWidth: 24,
          slotHeight: 24,
          surfaceWidth: 24,
          surfaceHeight: 24,
          clipped: false,
          focused: state.focused,
          attention: state.attention ? 1 : 0,
          titleClipped: state.longTitle,
        });
        expect(geometry.agent.titleGap).toBeCloseTo(8, 1);
        expect(geometry.agent.titleCenterDelta).toBeLessThanOrEqual(0.6);
      }

      await component.update({ props: { theme, zoom, activeAgent: 'b', ...states[0] } });
      expect(await component.getAttribute('data-active-agent')).toBe('panel-avatar-agent-b');
      const activeAgent = component.locator('[data-panel-agent-header-identity]');
      await expect(activeAgent).toContainText('Agent B');
      await expect(activeAgent.locator('svg[data-agent-avatar]')).toHaveCount(1);
      expect(await avatar.getAttribute('data-avatar-design')).not.toBe(initialDesign);
      await expect(activeAgent.locator('[data-agent-avatar-with-state]')).toHaveCount(0);

      const oppositeTheme = theme === 'light' ? 'dark' : 'light';
      await component.update({
        props: { theme: oppositeTheme, zoom, activeAgent: 'b', ...states[0] },
      });
      await expect(component).toHaveAttribute('data-theme', oppositeTheme);
      await expect(agentSlot.locator('svg[data-agent-avatar]')).toHaveCount(1);
      await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
    });
  }
}
