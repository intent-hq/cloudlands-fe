import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { loadBundledInterFont } from './test-fonts';
import { agentAvatarVariants } from '../src/features/agent/components/agent-avatar/avatar-size';
import {
  agentAvatarCatalogIdentities,
  agentAvatarCatalogStates,
} from '../src/features/agent/components/agent-avatar/agent-avatar.catalog';

// Each test mounts a fresh host; report every contract failure independently.
test.describe.configure({ mode: 'default', timeout: 120_000 });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('agent-avatar', {
      override: process.env.AGENT_AVATAR_VITE_CACHE_DIR,
    }),
    plugins: [svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') })],
    resolve: {
      alias: [
        { find: '$lib', replacement: resolve(process.cwd(), 'src/lib') },
        { find: '$features', replacement: resolve(process.cwd(), 'src/features') },
        { find: '$shared', replacement: resolve(process.cwd(), 'src/shared') },
        { find: '$store', replacement: resolve(process.cwd(), 'src/store') },
        { find: '$app', replacement: resolve(process.cwd(), 'playwright/app-stubs') },
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: resolve(process.cwd(), 'src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: resolve(process.cwd(), 'src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

// Text metrics feed the avatar stack's overflow badge width, so the harness uses the
// repo-bundled Inter Variable (like the CT harness and /sandbox) rather than host fonts.
async function mountAvatarHost(page: Page) {
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/lib/styles/tokens.css` });
  await loadBundledInterFont(page, { baseUrl });
  await page.evaluate(async () => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    const [{ mount, tick }, { default: Host }] = await Promise.all([
      import('/@id/svelte'),
      import('/test/fixtures/AgentAvatarHost.svelte'),
    ]);
    mount(Host, { target: document.body });
    await tick();
  });
}

type Rgba = [number, number, number, number];

async function computedPresentation(locator: Locator) {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    const toRgba = (value: string): Rgba => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('2D canvas is unavailable');
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data) as Rgba;
    };
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      background: toRgba(style.backgroundColor),
      foreground: toRgba(style.color),
    };
  });
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const luminance = ([red, green, blue]: Rgba) => {
    const channel = (value: number) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function colorDistance(first: Rgba, second: Rgba): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

// Avatar palette batch (96e48a0b): failures are red; completed glyphs use semantic ink.
type SurfaceFamily = 'neutral' | 'completed' | 'attention' | 'failed' | 'active' | 'waiting';

const surfaceFamilyByState = {
  running: 'active',
  responding: 'active',
  unread: 'neutral',
  completed: 'completed',
  failed: 'failed',
  waiting: 'waiting',
  'needs-permission': 'attention',
  'attention-discussion': 'attention',
  'attention-blocker': 'attention',
  idle: 'neutral',
} as const satisfies Record<string, SurfaceFamily>;

const expectedSurfaceByTheme = {
  light: {
    neutral: [225, 223, 222, 255],
    completed: [220, 229, 224, 255],
    attention: [255, 162, 64, 255],
    failed: [228, 88, 88, 255],
    active: [209, 226, 78, 255],
    waiting: [196, 167, 242, 255],
  },
  dark: {
    neutral: [192, 206, 198, 255],
    completed: [53, 70, 60, 255],
    attention: [255, 181, 102, 255],
    failed: [239, 118, 118, 255],
    active: [222, 237, 110, 255],
    waiting: [176, 150, 232, 255],
  },
} as const satisfies Record<'light' | 'dark', Record<SurfaceFamily, Rgba>>;

test('renders every vector and state without provider or status overlays', async ({ page }) => {
  await mountAvatarHost(page);
  const catalog = page.locator('[data-agent-avatar-catalog]');
  const expectedCatalogStateCount =
    agentAvatarCatalogIdentities.length * agentAvatarCatalogStates.length;
  expect(agentAvatarCatalogIdentities).toHaveLength(13);
  expect(agentAvatarCatalogStates).toHaveLength(11);
  expect(expectedCatalogStateCount).toBe(143);
  await expect(page.locator('[data-catalog-avatar-design]')).toHaveCount(13);
  await expect(
    catalog.locator('.agent-avatar-catalog-states [data-agent-avatar-with-state]'),
  ).toHaveCount(expectedCatalogStateCount);
  await expect(
    catalog.locator('.agent-avatar-catalog-states [data-avatar-state="idle"]'),
  ).toHaveCount(13);
  const avatarSurfaces = page.locator(
    '[data-agent-avatar-with-state], [data-agent-message-leading-identity]',
  );
  await expect(
    avatarSurfaces.locator('img, [data-provider-icon], [data-avatar-overlay], [data-icon]'),
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-coordinator-message-cards] [data-testid="agent-message-chevron-column"] [data-icon]',
    ),
  ).toHaveCount(2);
  await expect(
    page.locator('[data-testid="agent-message-chevron-column"] [data-icon]'),
  ).toHaveCount(7);
  await expect(catalog.locator('.agent-avatar-catalog-states [data-agent-avatar]')).toHaveCount(
    expectedCatalogStateCount,
  );
});

test('renders repeated Coordinator message cards with canonical identity on the runtime path', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountAvatarHost(page);
  const host = page.locator('[data-coordinator-message-cards]');
  const cards = host.locator('[data-coordinator-message-card]');
  await expect(cards).toHaveCount(2);

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    for (const width of [220, 420]) {
      for (const zoom of [1, 2]) {
        await host.evaluate(
          (node, geometry) => {
            const element = node as HTMLElement;
            element.style.width = `${geometry.width}px`;
            element.style.zoom = String(geometry.zoom);
          },
          { width, zoom },
        );

        for (let index = 0; index < 2; index += 1) {
          const card = cards.nth(index);
          const identity = card.locator('[data-agent-message-leading-identity]');
          const avatar = card.locator('[data-agent-avatar-surface]');
          const glyph = avatar.locator('[data-agent-avatar]');
          await expect(glyph).toHaveAttribute('data-avatar-design', 'coordinator');
          await expect(avatar).toHaveAttribute('data-avatar-state', 'idle');
          await expect(avatar).toHaveAttribute('data-avatar-variant', 'standard');
          await expect(identity.locator('[data-avatar-overlay], [data-icon], img')).toHaveCount(0);
          await expect(
            card.locator('[data-testid="agent-message-chevron-column"] [data-icon]'),
          ).toHaveCount(1);
          await expect(card.getByTestId('agent-message-attribution')).toHaveAccessibleName(
            'Coordinator',
          );
          await expect(card.getByTestId('agent-message-disclosure-toggle')).toHaveAccessibleName(
            'sent a message',
          );
        }
      }
    }
  }

  const coordinatorButton = cards.first().getByTestId('agent-message-attribution');
  await coordinatorButton.hover({ force: true });
  await coordinatorButton.focus();
  await expect(coordinatorButton).toBeFocused();
});

test('resolves computed attribution surfaces for every canonical semantic state', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await mountAvatarHost(page);
  const stateCards = page.locator('[data-attribution-state-cards]');
  const expectedStates = {
    neutral: ['idle', 'neutral'],
    running: ['running', 'active'],
    waiting: ['waiting', 'waiting'],
    error: ['failed', 'failed'],
    attention: ['attention-discussion', 'attention'],
  } as const;

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await page.waitForTimeout(250);
    for (const [cardName, [state, family]] of Object.entries(expectedStates)) {
      const card = stateCards.locator(`[data-attribution-state-card="${cardName}"]`);
      const avatar = card.locator('[data-agent-avatar-surface]');
      await expect(avatar).toHaveAttribute('data-avatar-state', state);
      const presentation = await computedPresentation(avatar);
      expect(presentation.background).toEqual(expectedSurfaceByTheme[theme][family]);
      await expect(card.locator('button')).toHaveCount(2);
      await expect(card.locator('button button')).toHaveCount(0);
    }
  }
});

test('keeps named surface and art geometry clear at 200% zoom', async ({ page }) => {
  await mountAvatarHost(page);
  for (const variant of agentAvatarVariants) {
    for (const design of ['coordinator', 'implementor']) {
      const sample = page.locator(
        `[data-avatar-variant-sample="${variant}"][data-avatar-optical-design="${design}"]`,
      );
      const svg = sample.locator('svg');
      const glyphBounds = await svg.evaluate((node) => {
        const box = (node as SVGGraphicsElement).getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
      expect(glyphBounds.x).toBeGreaterThanOrEqual(0);
      expect(glyphBounds.y).toBeGreaterThanOrEqual(0);
      expect(glyphBounds.x + glyphBounds.width).toBeLessThanOrEqual(16);
      expect(glyphBounds.y + glyphBounds.height).toBeLessThanOrEqual(16);
      await expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
      await expect(svg).toHaveAttribute('data-avatar-design', design);
    }
  }
});

test('resolves opaque, separated semantic state tokens in light and dark modes', async ({
  page,
}) => {
  await mountAvatarHost(page);

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await page.waitForTimeout(250);
    const backgrounds = new Set<string>();
    for (const [state, family] of Object.entries(surfaceFamilyByState)) {
      const avatar = page.locator(`[data-avatar-state="${state}"]`).first();
      const presentation = await computedPresentation(avatar);
      const tokenChannels = await avatar.evaluate(
        (node, token) => getComputedStyle(node).getPropertyValue(token).trim(),
        `--agent-avatar-surface-${family}`,
      );
      expect(presentation.background[3], `${theme} ${state} must be opaque`).toBe(255);
      expect(presentation.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(tokenChannels).not.toBe('');
      expect(
        colorDistance(presentation.background, expectedSurfaceByTheme[theme][family]),
      ).toBeLessThanOrEqual(1);
      expect(
        contrastRatio(presentation.foreground, presentation.background),
        `${theme} ${state} glyph contrast (${presentation.foreground.join(',')} on ${presentation.background.join(',')})`,
      ).toBeGreaterThanOrEqual(3);
      backgrounds.add(presentation.background.join(','));
    }
    const familyColors = Object.values(expectedSurfaceByTheme[theme]);
    expect(backgrounds.size).toBe(familyColors.length);
    for (const [index, first] of familyColors.entries()) {
      for (const second of familyColors.slice(index + 1)) {
        expect(colorDistance(first, second)).toBeGreaterThan(8);
        // Avatar palette batch (96e48a0b) uses muted neutral beside pale completed green.
        if (
          theme === 'light' &&
          first === expectedSurfaceByTheme.light.neutral &&
          second === expectedSurfaceByTheme.light.completed
        ) {
          expect(colorDistance(first, second)).toBeCloseTo(Math.sqrt(65), 6);
        } else {
          expect(colorDistance(first, second)).toBeGreaterThan(15);
        }
      }
    }
    const waiting = expectedSurfaceByTheme[theme].waiting;
    for (const [family, color] of Object.entries(expectedSurfaceByTheme[theme])) {
      if (family !== 'waiting') expect(colorDistance(waiting, color)).toBeGreaterThan(60);
    }
  }
});

test("keeps every SVG path and circle on the state's opaque foreground in each color mode", async ({
  page,
}) => {
  await mountAvatarHost(page);

  for (const mode of ['light', 'dark', 'forced-colors'] as const) {
    await page.emulateMedia({ forcedColors: mode === 'forced-colors' ? 'active' : 'none' });
    await page.evaluate((selectedMode) => {
      document.documentElement.classList.toggle('dark', selectedMode === 'dark');
      document.documentElement.classList.toggle('light', selectedMode === 'light');
    }, mode);

    const rows = page.locator('[data-catalog-avatar-design]');
    for (let rowIndex = 0; rowIndex < (await rows.count()); rowIndex += 1) {
      const presentations = await rows
        .nth(rowIndex)
        .locator('[data-agent-avatar-with-state]')
        .evaluateAll((avatars) =>
          avatars.map((avatar) => ({
            state: avatar.getAttribute('data-avatar-state'),
            color: getComputedStyle(avatar).color,
            opacity: getComputedStyle(avatar).opacity,
            shapes: Array.from(avatar.querySelectorAll('path, circle, rect')).map((shape) => {
              const style = getComputedStyle(shape);
              return { fill: style.fill, stroke: style.stroke, opacity: style.opacity };
            }),
          })),
        );
      // Avatar palette batch (96e48a0b) gives completed avatars their own foreground.
      for (const presentation of presentations) {
        expect(presentation.opacity).toBe('1');
        if (mode !== 'forced-colors') {
          const completedForeground = mode === 'light' ? 'rgb(42, 81, 64)' : 'rgb(212, 226, 216)';
          expect(presentation.color).toBe(
            presentation.state === 'completed' ? completedForeground : 'rgb(0, 0, 0)',
          );
        }
        for (const shape of presentation.shapes) {
          for (const paint of [shape.fill, shape.stroke]) {
            if (paint !== 'none') expect(paint).toBe(presentation.color);
          }
          expect(shape.opacity).toBe('1');
        }
      }
    }
  }
});

test('computes butt caps and miter joins across avatar modes, widths, and zoom levels', async ({
  page,
}) => {
  await mountAvatarHost(page);
  for (const mode of ['light', 'dark', 'system-light', 'system-dark', 'forced-colors'] as const) {
    await page.emulateMedia({
      colorScheme: mode === 'dark' || mode === 'system-dark' ? 'dark' : 'light',
      forcedColors: mode === 'forced-colors' ? 'active' : 'none',
      reducedMotion: mode === 'system-dark' ? 'reduce' : 'no-preference',
    });
    await page.evaluate((selectedMode) => {
      document.documentElement.classList.toggle('light', selectedMode === 'light');
      document.documentElement.classList.toggle('dark', selectedMode === 'dark');
    }, mode);
    for (const width of [320, 1280]) {
      for (const zoom of [1, 2]) {
        await page.locator('[data-agent-avatar-host]').evaluate(
          (node, geometry) => {
            const host = node as HTMLElement;
            host.style.width = `${geometry.width}px`;
            host.style.zoom = String(geometry.zoom);
          },
          { width, zoom },
        );
        const geometry = await page.locator('[data-agent-avatar]').evaluateAll((avatars) =>
          avatars.flatMap((avatar) =>
            Array.from(avatar.querySelectorAll('path, rect, circle')).map((shape) => {
              const style = getComputedStyle(shape);
              return { linecap: style.strokeLinecap, linejoin: style.strokeLinejoin };
            }),
          ),
        );
        expect(geometry.length).toBeGreaterThan(0);
        expect(new Set(geometry.map(({ linecap }) => linecap))).toEqual(new Set(['butt']));
        expect(new Set(geometry.map(({ linejoin }) => linejoin))).toEqual(new Set(['miter']));
      }
    }
  }
});

test('shows the state surface in the live subscription consumer', async ({ page }) => {
  await mountAvatarHost(page);
  const subscriptionAvatar = page.locator(
    '[data-live-subscription-row] [data-agent-avatar-surface]',
  );
  await expect(subscriptionAvatar).toHaveCount(1);
  await expect(subscriptionAvatar).toHaveAttribute('data-avatar-state', 'completed');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await page.waitForTimeout(250);
    const presentation = await computedPresentation(subscriptionAvatar);
    expect(presentation.background[3]).toBe(255);
    expect(
      colorDistance(presentation.background, expectedSurfaceByTheme[theme].completed),
    ).toBeLessThanOrEqual(1);
  }
});

test('is legible in light, dark, forced-colors, and reduced-motion modes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountAvatarHost(page);
  const avatar = page.locator('.theme-avatar');

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    const color = await avatar.evaluate((node) => getComputedStyle(node).color);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  }

  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const presentation = await avatar.evaluate((node) => {
    const style = getComputedStyle(node);
    const pseudo = getComputedStyle(node, '::after');
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      radius: style.borderRadius,
      clipPath: style.clipPath,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      pseudoContent: pseudo.content,
      pseudoWidth: pseudo.borderTopWidth,
      transitionDuration: style.transitionDuration,
    };
  });
  expect(presentation.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(presentation.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(presentation.outlineStyle).toBe('solid');
  expect(presentation.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(presentation.pseudoContent).toBe('none');
  expect(Number.parseFloat(presentation.transitionDuration)).toBeLessThan(0.001);
  await expect(avatar).toHaveAccessibleName(/discussion/i);
});
