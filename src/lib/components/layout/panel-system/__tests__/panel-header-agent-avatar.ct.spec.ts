import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderAvatarHost from './mocks/PanelHeaderAvatarHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`renders the production agent chat-bubble identity in ${theme}`, async ({ mount }) => {
    const component = await mount(PanelHeaderAvatarHost, {
      props: { theme, width: 260, zoom: 2, activeAgent: 'a' },
    });
    const slot = component.getByTestId('panel-header-agent-avatar-slot');
    const chatBubble = slot.locator('[data-panel-agent-chat-glyph]');

    await expect(chatBubble).toHaveCount(1);
    await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
    await expect(component.locator('[data-agent-avatar-surface]')).toHaveCount(0);
    const geometry = await chatBubble.evaluate((element) => {
      const bubbleRect = element.getBoundingClientRect();
      const slotRect = element.parentElement!.getBoundingClientRect();
      return {
        renderedWidth: bubbleRect.width,
        renderedHeight: bubbleRect.height,
        centerDeltaX: bubbleRect.left + bubbleRect.width / 2 - (slotRect.left + slotRect.width / 2),
        centerDeltaY: bubbleRect.top + bubbleRect.height / 2 - (slotRect.top + slotRect.height / 2),
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
    await expect(activeAgent.locator('[data-panel-agent-chat-glyph]')).toHaveCount(1);
    await expect(activeAgent.locator('[data-agent-avatar-with-state]')).toHaveCount(0);

    const oppositeTheme = theme === 'light' ? 'dark' : 'light';
    await component.update({
      props: { theme: oppositeTheme, width: 260, zoom: 2, activeAgent: 'b' },
    });
    await expect(component).toHaveAttribute('data-theme', oppositeTheme);
    await expect(slot.locator('[data-panel-agent-chat-glyph]')).toHaveCount(1);
    await expect(component.locator('[data-agent-avatar-with-state]')).toHaveCount(0);
  });
}
