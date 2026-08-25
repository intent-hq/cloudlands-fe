import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderAvatarHost from './mocks/PanelHeaderAvatarHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`renders the production agent avatar identity in ${theme}`, async ({ mount }) => {
    const component = await mount(PanelHeaderAvatarHost, {
      props: { theme, width: 260, zoom: 2, activeAgent: 'a' },
    });
    const slot = component.getByTestId('panel-header-agent-avatar-slot');
    const avatar = slot.locator('svg[data-agent-avatar]');

    await expect(avatar).toHaveCount(1);
    await expect(avatar).toHaveAttribute('data-avatar-variant', 'compact');
    await expect(slot.locator('[data-panel-agent-chat-glyph]')).toHaveCount(0);
    await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
    const initialDesign = await avatar.getAttribute('data-avatar-design');
    const geometry = await avatar.evaluate((element) => {
      const avatarRect = element.getBoundingClientRect();
      const slotRect = element.parentElement!.getBoundingClientRect();
      return {
        renderedWidth: avatarRect.width,
        renderedHeight: avatarRect.height,
        centerDeltaX: avatarRect.left + avatarRect.width / 2 - (slotRect.left + slotRect.width / 2),
        centerDeltaY: avatarRect.top + avatarRect.height / 2 - (slotRect.top + slotRect.height / 2),
      };
    });
    expect(geometry.renderedWidth).toBeCloseTo(32, 1);
    expect(geometry.renderedHeight).toBeCloseTo(32, 1);
    expect(geometry.centerDeltaX).toBeCloseTo(0, 1);
    expect(geometry.centerDeltaY).toBeCloseTo(0, 1);

    await component.update({ props: { theme, width: 260, zoom: 2, activeAgent: 'b' } });
    expect(await component.getAttribute('data-active-agent')).toBe('panel-avatar-agent-b');
    const activeAgent = component.locator('[data-panel-agent-header-identity]');
    await expect(activeAgent).toContainText('Agent B');
    await expect(activeAgent.locator('svg[data-agent-avatar]')).toHaveCount(1);
    expect(await avatar.getAttribute('data-avatar-design')).not.toBe(initialDesign);
    await expect(activeAgent.locator('[data-agent-avatar-with-state]')).toHaveCount(0);

    const oppositeTheme = theme === 'light' ? 'dark' : 'light';
    await component.update({
      props: { theme: oppositeTheme, width: 260, zoom: 2, activeAgent: 'b' },
    });
    await expect(component).toHaveAttribute('data-theme', oppositeTheme);
    await expect(slot.locator('svg[data-agent-avatar]')).toHaveCount(1);
    await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
  });
}
