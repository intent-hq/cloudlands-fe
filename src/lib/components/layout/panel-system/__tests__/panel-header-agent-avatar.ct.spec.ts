import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderAvatarHost from './mocks/PanelHeaderAvatarHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`renders live production panel-avatar states without remounting in ${theme}`, async ({
    mount,
  }) => {
    const component = await mount(PanelHeaderAvatarHost, {
      props: { theme, width: 260, zoom: 2, scenario: 'idle' },
    });
    const slot = component.getByTestId('panel-header-agent-avatar-slot');
    const avatar = slot.locator('[data-agent-avatar-with-state]');

    await expect(avatar).toHaveAttribute('data-avatar-state', 'idle');
    await expect(avatar).toHaveAttribute('data-avatar-variant', 'standard');
    await expect(avatar.locator('svg[data-agent-avatar]')).toHaveCount(1);
    await expect(avatar.locator('[data-testid="mock-avatar"]')).toHaveCount(0);
    const geometry = await avatar.evaluate((element) => {
      const avatarRect = element.getBoundingClientRect();
      const slotRect = element.parentElement!.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: style.width,
        height: style.height,
        radius: style.borderRadius,
        renderedWidth: avatarRect.width,
        renderedHeight: avatarRect.height,
        centerDeltaX: avatarRect.left + avatarRect.width / 2 - (slotRect.left + slotRect.width / 2),
        centerDeltaY: avatarRect.top + avatarRect.height / 2 - (slotRect.top + slotRect.height / 2),
      };
    });
    expect(geometry).toMatchObject({ width: '20px', height: '20px', radius: '6px' });
    expect(geometry.renderedWidth).toBeCloseTo(40, 1);
    expect(geometry.renderedHeight).toBeCloseTo(40, 1);
    expect(geometry.centerDeltaX).toBeCloseTo(0, 1);
    expect(geometry.centerDeltaY).toBeCloseTo(0, 1);

    await avatar.evaluate((element) => element.setAttribute('data-identity-proof', 'original'));
    let activeSurface = '';
    for (const scenario of ['responding', 'processing'] as const) {
      await component.update({ props: { theme, width: 260, zoom: 2, scenario } });
      await expect(avatar).toHaveAttribute('data-avatar-state', 'running');
      await expect(avatar).toHaveAttribute('data-identity-proof', 'original');
      await expect
        .poll(async () => {
          const colors = await avatar.evaluate((element) => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = 'hsl(var(--agent-avatar-surface-active))';
            element.parentElement!.append(probe);
            const resolvedActiveSurface = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return {
              background: getComputedStyle(element).backgroundColor,
              activeSurface: resolvedActiveSurface,
            };
          });
          activeSurface = colors.activeSurface;
          return colors.background === colors.activeSurface;
        })
        .toBe(true);
    }

    for (const [scenario, state] of [
      ['waiting', 'waiting'],
      ['failed', 'failed'],
      ['permission', 'needs-permission'],
    ] as const) {
      await component.update({ props: { theme, width: 260, zoom: 2, scenario } });
      await expect(avatar).toHaveAttribute('data-avatar-state', state);
      await expect(avatar).toHaveAttribute('data-identity-proof', 'original');
    }

    await component.update({
      props: { theme, width: 260, zoom: 2, scenario: 'agent-switch' },
    });
    expect(await component.getAttribute('data-active-agent')).toBe('panel-avatar-agent-b');
    expect(await avatar.getAttribute('data-avatar-state')).toBe('running');

    await component.update({ props: { theme, width: 260, zoom: 2, scenario: 'responding' } });
    await expect(avatar).toHaveAttribute('data-avatar-state', 'running');
    await avatar.evaluate((element) => element.setAttribute('data-completion-proof', 'same-node'));
    await component.update({ props: { theme, width: 260, zoom: 2, scenario: 'completed' } });
    await expect(avatar).toHaveAttribute('data-avatar-state', 'idle');
    await expect(avatar).toHaveAttribute('data-completion-proof', 'same-node');

    const oppositeTheme = theme === 'light' ? 'dark' : 'light';
    await component.update({
      props: { theme: oppositeTheme, width: 260, zoom: 2, scenario: 'responding' },
    });
    await expect(avatar).toHaveAttribute('data-avatar-state', 'running');
    let oppositeActiveSurface = '';
    await expect
      .poll(async () => {
        const colors = await avatar.evaluate((element) => {
          const probe = document.createElement('span');
          probe.style.backgroundColor = 'hsl(var(--agent-avatar-surface-active))';
          element.parentElement!.append(probe);
          const resolvedActiveSurface = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return {
            background: getComputedStyle(element).backgroundColor,
            activeSurface: resolvedActiveSurface,
          };
        });
        oppositeActiveSurface = colors.activeSurface;
        return colors.background === colors.activeSurface && colors.activeSurface !== activeSurface;
      })
      .toBe(true);
    expect(oppositeActiveSurface).not.toBe(activeSurface);
    await expect(avatar).toHaveAttribute('data-completion-proof', 'same-node');
  });
}
