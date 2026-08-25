import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderAvatarHost from './mocks/PanelHeaderAvatarHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2] as const) {
    test(`renders the production agent avatar identity in ${theme} at ${zoom * 100}% zoom`, async ({
      mount,
    }) => {
      const component = await mount(PanelHeaderAvatarHost, {
        props: { theme, width: 260, zoom, activeAgent: 'a' },
      });
      const slot = component.getByTestId('panel-header-agent-avatar-slot');
      const avatar = slot.locator('svg[data-agent-avatar]');

      await expect(avatar).toHaveCount(1);
      await expect(avatar).toHaveAttribute('data-avatar-variant', 'standard');
      await expect(slot.locator('[data-panel-agent-chat-glyph]')).toHaveCount(0);
      await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
      const initialDesign = await avatar.getAttribute('data-avatar-design');
      const geometry = await avatar.evaluate((element, selectedZoom) => {
        const avatarRect = element.getBoundingClientRect();
        const slotRect = element.parentElement!.getBoundingClientRect();
        const header = element.closest<HTMLElement>('[data-panel-content-header]')!;
        const headerRect = header.getBoundingClientRect();
        const titleRect = header
          .querySelector<HTMLElement>('[data-panel-header-title]')!
          .getBoundingClientRect();
        const avatarStyle = getComputedStyle(element);
        const scale = selectedZoom;
        return {
          slotWidth: slotRect.width / scale,
          avatarWidth: avatarRect.width / scale,
          avatarHeight: avatarRect.height / scale,
          avatarContentWidth:
            avatarRect.width / scale -
            Number.parseFloat(avatarStyle.paddingLeft) -
            Number.parseFloat(avatarStyle.paddingRight),
          avatarCenterDeltaX:
            Math.abs(
              avatarRect.left + avatarRect.width / 2 - (slotRect.left + slotRect.width / 2),
            ) / scale,
          avatarCenterDeltaY:
            Math.abs(
              avatarRect.top + avatarRect.height / 2 - (slotRect.top + slotRect.height / 2),
            ) / scale,
          titleCenterDelta:
            Math.abs(
              titleRect.top + titleRect.height / 2 - (headerRect.top + headerRect.height / 2),
            ) / scale,
        };
      }, zoom);
      expect(geometry.slotWidth).toBeCloseTo(24, 1);
      expect(geometry.avatarWidth).toBeCloseTo(20, 1);
      expect(geometry.avatarHeight).toBeCloseTo(20, 1);
      expect(geometry.avatarContentWidth).toBeCloseTo(16, 1);
      expect(geometry.avatarCenterDeltaX).toBeLessThanOrEqual(0.6);
      expect(geometry.avatarCenterDeltaY).toBeLessThanOrEqual(0.6);
      expect(geometry.titleCenterDelta).toBeLessThanOrEqual(0.6);

      await component.update({ props: { theme, width: 260, zoom, activeAgent: 'b' } });
      expect(await component.getAttribute('data-active-agent')).toBe('panel-avatar-agent-b');
      const activeAgent = component.locator('[data-panel-agent-header-identity]');
      await expect(activeAgent).toContainText('Agent B');
      await expect(activeAgent.locator('svg[data-agent-avatar]')).toHaveCount(1);
      expect(await avatar.getAttribute('data-avatar-design')).not.toBe(initialDesign);
      await expect(activeAgent.locator('[data-agent-avatar-with-state]')).toHaveCount(0);

      const oppositeTheme = theme === 'light' ? 'dark' : 'light';
      await component.update({
        props: { theme: oppositeTheme, width: 260, zoom, activeAgent: 'b' },
      });
      await expect(component).toHaveAttribute('data-theme', oppositeTheme);
      await expect(slot.locator('svg[data-agent-avatar]')).toHaveCount(1);
      await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
    });
  }
}
