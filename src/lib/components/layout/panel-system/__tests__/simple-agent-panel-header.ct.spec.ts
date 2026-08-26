import { expect, test } from '@playwright/experimental-ct-svelte';
import SimpleAgentPanelHeaderHost from './mocks/SimpleAgentPanelHeaderHost.svelte';

const names = {
  root: 'Root coordinator with a deliberately long current agent name',
  delegated: 'Layout verifier with a deliberately long current agent name',
} as const;

test('shows only the current agent identity across root, delegated, single, stacked, and width states', async ({
  mount,
}) => {
  const component = await mount(SimpleAgentPanelHeaderHost);

  for (const activeAgent of ['root', 'delegated'] as const) {
    for (const stackCount of [1, 2] as const) {
      for (const width of [240, 560]) {
        await component.update({ props: { activeAgent, stackCount, width } });
        const header = component.locator('[data-panel-tabless-header]');
        const identity = header.locator('[data-panel-agent-header-identity]');
        const currentName = names[activeAgent];
        const otherName = names[activeAgent === 'root' ? 'delegated' : 'root'];

        await expect(identity).toHaveCount(1);
        const avatarSlot = identity.getByTestId('panel-header-agent-avatar-slot');
        const avatar = avatarSlot.locator('svg[data-agent-avatar]');
        await expect(avatar).toHaveCount(1);
        await expect(avatar).toHaveAttribute('data-avatar-variant', 'emphasized');
        await expect(avatar).toHaveAttribute('width', '24');
        await expect(avatar).toHaveAttribute('height', '24');
        await expect(avatarSlot.locator('[data-panel-agent-chat-glyph]')).toHaveCount(0);
        await expect(avatarSlot.locator('[data-panel-agent-chat-text-glyph]')).toHaveCount(0);
        const stateAvatar = identity.locator('[data-agent-avatar-with-state]');
        await expect(stateAvatar).toHaveCount(1);
        await expect(stateAvatar).toHaveAttribute('data-avatar-state', 'idle');
        const geometry = await avatarSlot.evaluate((slot) => {
          const avatar = slot.querySelector<SVGElement>('[data-agent-avatar]')!;
          const slotRect = slot.getBoundingClientRect();
          const avatarRect = avatar.getBoundingClientRect();
          return {
            slot: [slotRect.width, slotRect.height],
            avatar: [avatarRect.width, avatarRect.height],
          };
        });
        expect(geometry).toEqual({ slot: [24, 24], avatar: [24, 24] });
        await expect(identity.getByRole('button', { name: currentName })).toHaveCount(1);
        await expect(header).not.toContainText(otherName);
        await expect(header.getByTestId('pane-stack-selector-trigger')).toHaveCount(
          stackCount > 1 ? 1 : 0,
        );
        await expect(header.locator('[data-pane-stack-layer]')).toHaveCount(0);
        await expect(header.locator('[data-pane-stack-position]')).toHaveCount(0);
        await expect(header.locator('[data-pane-stack-overflow-trigger]')).toHaveCount(0);
        await expect(header.locator('[data-panel-identity-back]')).toHaveCount(0);
        await expect(header.locator('[data-panel-identity-forward]')).toHaveCount(0);
        await expect(header.getByTestId('panel-actions-trigger')).toBeVisible();
        await expect(header.getByTestId('panel-close-button')).toBeVisible();

        const nameGeometry = await identity
          .getByRole('button', { name: currentName })
          .evaluate((element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            overflow: getComputedStyle(element).overflow,
            textOverflow: getComputedStyle(element).textOverflow,
          }));
        expect(nameGeometry.overflow).toBe('hidden');
        expect(nameGeometry.textOverflow).toBe('ellipsis');
        if (width === 240)
          expect(nameGeometry.scrollWidth).toBeGreaterThan(nameGeometry.clientWidth);
      }
    }
  }
});

test('keeps keyboard rename focus, cancel, and save behavior', async ({ mount, page }) => {
  const component = await mount(SimpleAgentPanelHeaderHost, {
    props: { activeAgent: 'delegated', stackCount: 2, width: 240 },
  });
  const identity = component.locator('[data-panel-agent-header-identity]');
  const nameButton = identity.getByRole('button', { name: names.delegated });

  await nameButton.focus();
  await page.keyboard.press('Enter');
  const input = identity.locator('input[type="text"]');
  await expect(input).toBeFocused();
  await input.fill('Cancelled verifier rename');
  await page.keyboard.press('Escape');
  await expect(component).toHaveAttribute('data-last-rename', '');
  await expect(identity.getByRole('button', { name: names.delegated })).toBeVisible();

  await identity.getByRole('button', { name: names.delegated }).press('Enter');
  await expect(input).toBeFocused();
  await input.fill('Renamed delegated agent');
  await page.keyboard.press('Enter');
  await expect(component).toHaveAttribute(
    'data-last-rename',
    'delegated-tab:Renamed delegated agent',
  );
  await expect(identity.getByRole('button', { name: 'Renamed delegated agent' })).toBeVisible();
});
