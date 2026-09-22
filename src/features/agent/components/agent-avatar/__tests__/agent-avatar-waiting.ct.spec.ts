import type { Locator, Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../../test/ct-test';
import AgentAvatarWaitingHost from './AgentAvatarWaitingHost.svelte';
import { agentAvatarGeometry } from '../avatar-size';
import type { AvatarState } from '../avatar-state';

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
      question: color('question'),
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
    expect(colors.unread).toBe(colors.idle);
    expect(colors.failed).not.toBe(colors.permission);
    expect(colors.question).toBe(colors.permission);
    expect(colors.question).toBe(colors.discussion);
    expect(colors.question).toBe(colors.blocker);
    const semanticForeground = await systemColor(
      page,
      'color',
      'hsl(var(--agent-avatar-foreground))',
    );

    for (const state of ['waiting', 'running', 'completed'] as const) {
      await component.update({ props: { theme, state } });
      expect(await reactive.evaluate((node) => node === (window as any).__waitingAvatarNode)).toBe(
        true,
      );
      await expect(reactive).toHaveAttribute('data-avatar-state', state);
      if (state === 'completed') {
        expect(await reactive.evaluate((node) => getComputedStyle(node).color)).not.toBe(
          semanticForeground,
        );
      } else {
        await expect(reactive).toHaveCSS('color', semanticForeground);
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

test('keeps a plain idle avatar glyph visible in dark mode', async ({ mount, page }) => {
  const component = await mount(AgentAvatarWaitingHost, { props: { theme: 'dark' } });
  await page.evaluate(() => document.documentElement.classList.add('dark'));

  const avatar = component.getByTestId('plain-idle-avatar').locator('[data-agent-avatar]');
  await expect(avatar).toHaveCSS('color', 'rgb(8, 8, 8)');
  await expect(avatar).toHaveCSS('background-color', 'rgb(192, 206, 198)');
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

const surfaceTokenByState = {
  idle: '--agent-avatar-surface-neutral',
  unread: '--agent-avatar-surface-neutral',
  running: '--agent-avatar-surface-active',
  completed: '--agent-avatar-surface-completed',
  waiting: '--agent-avatar-surface-waiting',
  failed: '--agent-avatar-surface-failed',
  question: '--agent-avatar-surface-attention',
  'needs-permission': '--agent-avatar-surface-attention',
  'attention-discussion': '--agent-avatar-surface-attention',
  'attention-blocker': '--agent-avatar-surface-attention',
} as const satisfies Partial<Record<AvatarState, string>>;

const forcedSurfaceByState = {
  idle: 'Canvas',
  running: 'Highlight',
  completed: 'ButtonFace',
  waiting: 'Field',
  failed: 'Mark',
  'attention-discussion': 'Mark',
} as const satisfies Partial<Record<AvatarState, string>>;

test('paints every state from its semantic surface token on one clipped rounded square', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentAvatarWaitingHost);
  const reactive = component
    .getByTestId('reactive-waiting-avatar')
    .locator('[data-agent-avatar-with-state]');
  const glyph = reactive.locator('[data-agent-avatar]');
  const radius = `${agentAvatarGeometry.standard.radius}px`;

  await expect(reactive).toHaveCSS('border-radius', radius);
  await expect(reactive).toHaveCSS('clip-path', `inset(0px round ${radius})`);
  await expect(reactive).toHaveCSS('box-shadow', 'none');
  expect(await reactive.evaluate((node) => getComputedStyle(node, '::after').content)).toBe('none');
  await expect(reactive).toHaveCSS('transition-property', 'background-color');
  await expect(glyph).toHaveCSS(
    'color',
    await reactive.evaluate((node) => getComputedStyle(node).color),
  );

  for (const [state, token] of Object.entries(surfaceTokenByState) as Array<
    [AvatarState, string]
  >) {
    await component.update({ props: { state } });
    await expect(reactive).toHaveAttribute('data-avatar-state', state);
    await expect(reactive).toHaveCSS(
      'background-color',
      await systemColor(page, 'backgroundColor', `hsl(var(${token}))`),
    );
    await expect(reactive).toHaveCSS(
      'color',
      await systemColor(
        page,
        'color',
        state === 'completed'
          ? 'hsl(var(--agent-avatar-foreground-completed))'
          : 'hsl(var(--agent-avatar-foreground))',
      ),
    );
    await expect(reactive).toHaveCSS(
      'transition-property',
      state === 'completed' ? 'none' : 'background-color',
    );
  }

  await component.update({ props: { state: 'unread' } });
  await expect(reactive.locator('[data-avatar-unread-dot]')).toHaveCSS(
    'background-color',
    await systemColor(page, 'backgroundColor', 'hsl(var(--workspace-status-unread))'),
  );

  await component.update({ props: { state: 'idle', motionReduced: true } });
  await expect(reactive).toHaveCSS('transition-property', 'none');
});

test('maps every state to a forced-colors system surface with a CanvasText outline', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const component = await mount(AgentAvatarWaitingHost);
  const reactive = component
    .getByTestId('reactive-waiting-avatar')
    .locator('[data-agent-avatar-with-state]');
  const glyph = reactive.locator('[data-agent-avatar]');
  const canvasText = await systemColor(page, 'color', 'CanvasText');

  for (const [state, surface] of Object.entries(forcedSurfaceByState) as Array<
    [AvatarState, string]
  >) {
    await component.update({ props: { state } });
    const background = await systemColor(page, 'backgroundColor', surface);
    await expect(reactive).toHaveCSS('background-color', background);
    await expect(glyph).toHaveCSS('background-color', background);
    await expect(reactive).toHaveCSS('outline-style', 'solid');
    await expect(reactive).toHaveCSS('outline-width', '1px');
    await expect(reactive).toHaveCSS('outline-color', canvasText);
  }

  await component.update({ props: { state: 'unread' } });
  await expect(reactive.locator('[data-avatar-unread-dot]')).toHaveCSS(
    'background-color',
    canvasText,
  );
});

test('keeps a legacy numeric size on a 1px clear space', async ({ mount }) => {
  const component = await mount(AgentAvatarWaitingHost);
  const legacy = component.getByTestId('legacy-sized-avatar').locator('[data-agent-avatar]');

  await expect(legacy).toHaveCSS('width', '18px');
  await expect(legacy).toHaveCSS('padding', '1px');
});

test('cuts every overlapped stack layer with the rounded-square silhouette', async ({ mount }) => {
  const component = await mount(AgentAvatarWaitingHost);
  const layer = component
    .locator('[data-agent-avatar-catalog-stack] [data-agent-avatar-stack-item]')
    .first();
  const geometry = agentAvatarGeometry.emphasized;

  await expect(layer).toHaveCSS('border-radius', `${geometry.radius}px`);
  await expect(layer).toHaveCSS('mask-size', '100% 100%');
  const maskImage = await layer.evaluate((node) => getComputedStyle(node).maskImage);
  expect(maskImage).not.toContain('radial-gradient');
  const encoded = maskImage.match(/^url\("data:image\/svg\+xml,(.*)"\)$/)?.[1];
  expect(encoded).toBeTruthy();
  const cutout = decodeURIComponent(encoded!).match(
    /<rect x='([^']+)' y='([^']+)' width='([^']+)' height='([^']+)' rx='([^']+)'/,
  );
  expect(cutout?.slice(1).map(Number)).toEqual([
    geometry.surface - geometry.overlap - geometry.ring,
    -geometry.ring,
    geometry.surface + 2 * geometry.ring,
    geometry.surface + 2 * geometry.ring,
    geometry.radius + geometry.ring,
  ]);
  expect(decodeURIComponent(encoded!)).toContain(
    `viewBox='0 0 ${geometry.surface} ${geometry.surface}'`,
  );
});
