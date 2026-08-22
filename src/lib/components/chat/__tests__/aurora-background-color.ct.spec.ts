import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import AuroraBackgroundColorHost from './AuroraBackgroundColorHost.svelte';

async function colorState(component: Locator) {
  return component.evaluate((root) => {
    const canvas = root.querySelector('canvas');
    const avatar = root.querySelector('[data-agent-avatar-with-state]');
    if (!(canvas instanceof HTMLCanvasElement) || !(avatar instanceof HTMLElement)) return null;

    return {
      avatar: getComputedStyle(avatar).backgroundColor,
      canvas: getComputedStyle(canvas).color,
    };
  });
}

async function expectAuroraToMatchRunningAvatar(component: Locator) {
  await expect
    .poll(async () => {
      const state = await colorState(component);
      return state?.canvas === state?.avatar;
    })
    .toBe(true);
}

test('keeps the Aurora semantic color equal to the running avatar across live changes', async ({
  mount,
  page,
}) => {
  const component = await mount(AuroraBackgroundColorHost, { props: { theme: 'light' } });

  await expectAuroraToMatchRunningAvatar(component);

  await component.update({ props: { theme: 'dark' } });
  await expectAuroraToMatchRunningAvatar(component);

  await page.evaluate(() => {
    document.documentElement.style.setProperty('--agent-avatar-surface-active', '42 80% 55%');
  });
  await expectAuroraToMatchRunningAvatar(component);

  await page.evaluate(() => {
    document.documentElement.style.removeProperty('--agent-avatar-surface-active');
  });
});
