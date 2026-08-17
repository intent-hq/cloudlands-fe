import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import AgentAvatarWaitingHost from './AgentAvatarWaitingHost.svelte';

type Rgb = readonly [number, number, number];

const waitingByTheme = {
  light: [196, 167, 242],
  dark: [176, 150, 232],
} as const satisfies Record<'light' | 'dark', Rgb>;

function parseRgb(value: string): Rgb {
  const channels = value
    .match(/[0-9]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Cannot parse color: ${value}`);
  return channels as unknown as Rgb;
}

function colorDistance(first: Rgb, second: Rgb): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

function rgbString(color: Rgb): string {
  return `rgb(${color.join(', ')})`;
}

async function surfaceColors(component: Locator) {
  return component.evaluate((root) => {
    const color = (state: string) =>
      getComputedStyle(root.querySelector(`[data-avatar-state="${state}"]`)!).backgroundColor;
    return {
      idle: color('idle'),
      waiting: color('waiting'),
      running: color('running'),
      completed: color('completed'),
      unread: color('unread'),
      failed: color('failed'),
      permission: color('needs-permission'),
      discussion: color('attention-discussion'),
      blocker: color('attention-blocker'),
    };
  });
}

async function systemColor(page: Page, property: 'backgroundColor' | 'color', value: string) {
  return page.evaluate(
    ({ propertyName, propertyValue }) => {
      const node = document.createElement('span');
      node.style[propertyName] = propertyValue;
      document.body.append(node);
      const resolved = getComputedStyle(node)[propertyName];
      node.remove();
      return resolved;
    },
    { propertyName: property, propertyValue: value },
  );
}

test('keeps waiting separate through a live same-node state transition', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentAvatarWaitingHost);
  const reactive = component
    .getByTestId('reactive-waiting-avatar')
    .locator('[data-agent-avatar-with-state]');

  for (const theme of ['light', 'dark'] as const) {
    await component.update({ props: { theme, state: 'idle' } });
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await expect(component.locator('[data-avatar-state="waiting"]').first()).toHaveCSS(
      'background-color',
      rgbString(waitingByTheme[theme]),
    );
    await reactive.evaluate((node) => ((window as any).__waitingAvatarNode = node));
    const colors = await surfaceColors(component);

    expect(parseRgb(colors.waiting)).toEqual(waitingByTheme[theme]);
    for (const color of [
      colors.idle,
      colors.running,
      colors.completed,
      colors.unread,
      colors.failed,
    ]) {
      expect(colorDistance(parseRgb(colors.waiting), parseRgb(color))).toBeGreaterThan(60);
    }
    expect(colors.running).not.toBe(colors.completed);
    expect(colors.failed).toBe(colors.permission);
    expect(colors.failed).toBe(colors.discussion);
    expect(colors.failed).toBe(colors.blocker);

    for (const state of ['waiting', 'running', 'completed'] as const) {
      await component.update({ props: { theme, state } });
      expect(await reactive.evaluate((node) => node === (window as any).__waitingAvatarNode)).toBe(
        true,
      );
      await expect(reactive).toHaveAttribute('data-avatar-state', state);
      if (state === 'completed') {
        expect(await reactive.evaluate((node) => getComputedStyle(node).color)).not.toBe(
          'rgb(8, 8, 8)',
        );
      } else {
        await expect(reactive).toHaveCSS('color', 'rgb(8, 8, 8)');
      }
      await expect(reactive).toHaveCSS('opacity', '1');
    }
  }

  await page.emulateMedia({ forcedColors: 'active' });
  await component.update({ props: { theme: 'light', state: 'waiting' } });
  await expect(reactive).toHaveCSS(
    'background-color',
    await systemColor(page, 'backgroundColor', 'Field'),
  );
  await expect(reactive).toHaveCSS('color', await systemColor(page, 'color', 'CanvasText'));
});

test('matches the light and dark waiting palette catalog at 20px and 200%', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentAvatarWaitingHost);
  const states = component
    .locator('[data-catalog-avatar-design="coordinator"]')
    .locator('.agent-avatar-catalog-states');

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2] as const) {
      await component.update({ props: { theme, state: 'waiting', zoom } });
      await page.evaluate((selectedTheme) => {
        document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
        document.documentElement.classList.toggle('light', selectedTheme === 'light');
      }, theme);
      await expect(states).toHaveScreenshot(
        `agent-avatar-waiting-${theme}-${zoom === 1 ? '20px' : '200-percent'}.png`,
      );
    }
  }
});
