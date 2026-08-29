import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { ViteDevServer } from 'vite';
import { createServer } from 'vite';
import {
  agentAvatarGeometry,
  agentAvatarVariants,
} from '../src/features/agent/components/agent-avatar/avatar-size';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

let server: ViteDevServer;
let baseUrl: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: process.env.AGENT_AVATAR_VITE_CACHE_DIR,
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

async function mountAvatarHost(page: Page) {
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/lib/styles/tokens.css` });
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

async function catalogPalettePng(locator: Locator, scale: number): Promise<Buffer> {
  const dataUrl = await locator.evaluate((node, selectedScale) => {
    const avatars = Array.from(node.querySelectorAll<HTMLElement>('[data-avatar-state]'));
    const size = 20 * selectedScale;
    const gap = 6 * selectedScale;
    const canvas = document.createElement('canvas');
    canvas.width = avatars.length * size + (avatars.length - 1) * gap;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable');
    for (const [index, avatar] of avatars.entries()) {
      context.fillStyle = getComputedStyle(avatar).backgroundColor;
      context.beginPath();
      context.roundRect(index * (size + gap), 0, size, size, size * 0.3);
      context.fill();
    }
    return canvas.toDataURL('image/png');
  }, scale);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

async function catalogStackPng(locator: Locator, scale: number): Promise<Buffer> {
  const dataUrl = await locator.evaluate((node, selectedScale) => {
    const items = Array.from(node.children) as HTMLElement[];
    const nodeRect = node.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(nodeRect.width * selectedScale);
    canvas.height = Math.ceil(nodeRect.height * selectedScale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable');
    for (const item of items) {
      const style = getComputedStyle(item);
      const itemRect = item.getBoundingClientRect();
      const x = (itemRect.left - nodeRect.left) * selectedScale;
      const y = (itemRect.top - nodeRect.top) * selectedScale;
      if (item.hasAttribute('data-agent-avatar-overflow')) {
        context.fillStyle = style.backgroundColor;
        context.beginPath();
        context.roundRect(
          x,
          y,
          itemRect.width * selectedScale,
          itemRect.height * selectedScale,
          (Number.parseFloat(style.borderRadius) || 0) * selectedScale,
        );
        context.fill();
        context.fillStyle = style.color;
        context.font = `500 ${12 * selectedScale}px system-ui`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(
          item.textContent?.trim() ?? '',
          x + (itemRect.width * selectedScale) / 2,
          canvas.height / 2,
        );
        continue;
      }
      const size = itemRect.width * selectedScale;
      context.beginPath();
      context.roundRect(x, y, size, size, 7 * selectedScale);
      context.fillStyle = style.backgroundColor;
      context.fill();
      context.strokeStyle = style.color;
      context.lineWidth = 1.25 * selectedScale;
      context.beginPath();
      context.moveTo(x + 8 * selectedScale, y + 8 * selectedScale);
      context.lineTo(x + 16 * selectedScale, y + 16 * selectedScale);
      context.moveTo(x + 16 * selectedScale, y + 8 * selectedScale);
      context.lineTo(x + 8 * selectedScale, y + 16 * selectedScale);
      context.stroke();
    }
    return canvas.toDataURL('image/png');
  }, scale);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
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

type SurfaceFamily = 'neutral' | 'completed' | 'attention' | 'active' | 'waiting';

const surfaceFamilyByState = {
  running: 'active',
  responding: 'active',
  unread: 'neutral',
  completed: 'completed',
  failed: 'attention',
  waiting: 'waiting',
  'needs-permission': 'attention',
  'attention-discussion': 'attention',
  'attention-blocker': 'attention',
  idle: 'neutral',
} as const satisfies Record<string, SurfaceFamily>;

const expectedSurfaceByTheme = {
  light: {
    neutral: [232, 237, 234, 255],
    completed: [220, 229, 224, 255],
    attention: [255, 162, 64, 255],
    active: [209, 226, 78, 255],
    waiting: [196, 167, 242, 255],
  },
  dark: {
    neutral: [192, 206, 198, 255],
    completed: [53, 70, 60, 255],
    attention: [255, 181, 102, 255],
    active: [222, 237, 110, 255],
    waiting: [176, 150, 232, 255],
  },
} as const satisfies Record<'light' | 'dark', Record<SurfaceFamily, Rgba>>;

test('renders every vector and state without provider or status overlays', async ({ page }) => {
  await mountAvatarHost(page);
  const catalog = page.locator('[data-agent-avatar-catalog]');
  await expect(page.locator('[data-catalog-avatar-design]')).toHaveCount(13);
  await expect(
    catalog.locator('.agent-avatar-catalog-states [data-agent-avatar-with-state]'),
  ).toHaveCount(130);
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
    130,
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
          const row = card.locator('[data-testid="agent-message-disclosure-header"]');
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
            /sent a message: Coordinator message/,
          );

          const [rowBox, identityBox, avatarBox, glyphBox] = await Promise.all([
            row.boundingBox(),
            identity.boundingBox(),
            avatar.boundingBox(),
            glyph.boundingBox(),
          ]);
          expect(rowBox).not.toBeNull();
          expect(identityBox).not.toBeNull();
          expect(avatarBox).not.toBeNull();
          expect(glyphBox).not.toBeNull();
          expect(avatarBox!.width).toBeCloseTo(20 * zoom, 1);
          expect(avatarBox!.height).toBeCloseTo(20 * zoom, 1);
          expect(glyphBox!.width).toBeCloseTo(20 * zoom, 1);
          expect(glyphBox!.height).toBeCloseTo(20 * zoom, 1);
          const geometry = await avatar.evaluate((node) => {
            const style = getComputedStyle(node);
            const pseudo = getComputedStyle(node, '::after');
            return {
              radius: style.borderRadius,
              pseudoContent: pseudo.content,
              pseudoWidth: pseudo.borderTopWidth,
            };
          });
          expect(geometry).toEqual({ radius: '6px', pseudoContent: 'none', pseudoWidth: '0px' });
          const rowCenter = rowBox!.y + rowBox!.height / 2;
          const identityCenter = identityBox!.y + identityBox!.height / 2;
          expect(
            Math.abs(rowCenter - identityCenter) * (await page.evaluate(() => devicePixelRatio)),
          ).toBeLessThanOrEqual(0.5);
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
    error: ['failed', 'attention'],
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
    const geometry = agentAvatarGeometry[variant];
    for (const design of ['coordinator', 'implementor']) {
      const sample = page.locator(
        `[data-avatar-variant-sample="${variant}"][data-avatar-optical-design="${design}"]`,
      );
      const surface = sample.locator('[data-agent-avatar-surface]');
      const svg = sample.locator('svg');
      const [surfaceBox, svgBox, glyphBounds, geometryStyles] = await Promise.all([
        surface.boundingBox(),
        svg.boundingBox(),
        svg.evaluate((node) => {
          const box = (node as SVGGraphicsElement).getBBox();
          return { x: box.x, y: box.y, width: box.width, height: box.height };
        }),
        surface.evaluate((node) => {
          const style = getComputedStyle(node);
          const pseudo = getComputedStyle(node, '::after');
          const art = getComputedStyle(node.querySelector('svg') as SVGElement);
          return {
            radius: style.borderRadius,
            clipPath: style.clipPath,
            pseudoContent: pseudo.content,
            pseudoWidth: pseudo.borderTopWidth,
            padding: art.paddingLeft,
            artSize: style.getPropertyValue('--agent-avatar-art-size').trim(),
            overlap: style.getPropertyValue('--agent-avatar-stack-overlap').trim(),
          };
        }),
      ]);
      expect(surfaceBox?.width).toBeCloseTo(geometry.surface * 2, 1);
      expect(surfaceBox?.height).toBeCloseTo(geometry.surface * 2, 1);
      expect(svgBox?.width).toBeCloseTo(geometry.surface * 2, 1);
      expect(svgBox?.height).toBeCloseTo(geometry.surface * 2, 1);
      expect(geometryStyles.radius).toBe(`${geometry.radius}px`);
      expect(geometryStyles.pseudoContent).toBe('none');
      expect(geometryStyles.pseudoWidth).toBe('0px');
      expect(geometryStyles.padding).toBe(`${geometry.clearSpace}px`);
      expect(geometryStyles.artSize).toBe(`${geometry.art}px`);
      expect(geometryStyles.overlap).toBe(`${geometry.overlap}px`);
      expect(geometryStyles.clipPath).toContain(`${geometry.radius}px`);
      expect(glyphBounds.x).toBeGreaterThanOrEqual(0);
      expect(glyphBounds.y).toBeGreaterThanOrEqual(0);
      expect(glyphBounds.x + glyphBounds.width).toBeLessThanOrEqual(16);
      expect(glyphBounds.y + glyphBounds.height).toBeLessThanOrEqual(16);
      await expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
      await expect(svg).toHaveAttribute('data-avatar-design', design);
    }
  }
});

test('fits the emphasized panel stack and aligned overflow count in a narrow tab', async ({
  page,
}) => {
  await mountAvatarHost(page);
  const host = page.locator('[data-live-panel-header]');
  const stack = host.locator('[data-agent-avatar-stack]');
  const avatars = stack.locator('[data-agent-avatar-with-state]');
  const overflow = stack.locator('[data-agent-avatar-overflow]');
  await expect(avatars).toHaveCount(2);
  for (let index = 0; index < 2; index += 1) {
    await expect(avatars.nth(index)).toHaveAttribute('data-avatar-variant', 'emphasized');
  }
  await expect(overflow).toHaveText('+2');
  await expect(host.getByRole('tab')).toHaveAccessibleDescription('+2');
  const overflowStyle = await overflow.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      fontSize: style.fontSize,
    };
  });
  expect(overflowStyle).toEqual({
    background: expect.not.stringMatching(/rgba\(0, 0, 0, 0\)|transparent/),
    borderWidth: '0px',
    borderRadius: '7px',
    boxShadow: 'none',
    fontSize: '12px',
  });
  for (const zoom of [1, 2]) {
    await host.evaluate((node, selectedZoom) => {
      node.style.zoom = String(selectedZoom);
    }, zoom);
    const [hostBox, stackBox, avatarBoxes, overflowBox] = await Promise.all([
      host.boundingBox(),
      stack.boundingBox(),
      avatars.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON())),
      overflow.boundingBox(),
    ]);
    const avatarTrackWidth = 24 * zoom + (avatarBoxes.length - 1) * 18 * zoom;
    expect(stackBox?.width).toBeCloseTo(avatarTrackWidth + overflowBox!.width - 6 * zoom, 1);
    expect(stackBox?.height).toBeCloseTo(24 * zoom, 1);
    expect(overflowBox?.width).toBeGreaterThanOrEqual(24 * zoom);
    expect(overflowBox?.height).toBeCloseTo(24 * zoom, 1);
    for (const box of avatarBoxes) {
      expect(box.width).toBeCloseTo(24 * zoom, 1);
      expect(box.height).toBeCloseTo(24 * zoom, 1);
    }
    expect(overflowBox!.x - avatarBoxes.at(-1)!.x).toBeCloseTo(18 * zoom, 1);
    const avatarCenter = avatarBoxes.at(-1)!.y + avatarBoxes.at(-1)!.height / 2;
    const overflowCenter = overflowBox!.y + overflowBox!.height / 2;
    expect(
      Math.abs(avatarCenter - overflowCenter) * (await page.evaluate(() => devicePixelRatio)),
    ).toBeLessThanOrEqual(0.5);
    expect((stackBox?.x ?? 0) + (stackBox?.width ?? 0)).toBeLessThanOrEqual(
      (hostBox?.x ?? 0) + (hostBox?.width ?? 0),
    );
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
        expect(colorDistance(first, second)).toBeGreaterThan(15);
      }
    }
    const waiting = expectedSurfaceByTheme[theme].waiting;
    for (const [family, color] of Object.entries(expectedSurfaceByTheme[theme])) {
      if (family !== 'waiting') expect(colorDistance(waiting, color)).toBeGreaterThan(60);
    }
  }
});

test('keeps every SVG path and circle color identical across states and color modes', async ({
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
            color: getComputedStyle(avatar).color,
            opacity: getComputedStyle(avatar).opacity,
            shapes: Array.from(avatar.querySelectorAll('path, circle, rect')).map((shape) => {
              const style = getComputedStyle(shape);
              return { fill: style.fill, stroke: style.stroke, opacity: style.opacity };
            }),
          })),
        );
      for (const presentation of presentations.slice(1)) {
        expect(presentation).toEqual(presentations[0]);
      }
      expect(presentations[0]?.opacity).toBe('1');
      if (mode !== 'forced-colors') {
        expect(presentations[0]?.color).toBe('rgb(8, 8, 8)');
        for (const shape of presentations[0]?.shapes ?? []) {
          for (const paint of [shape.fill, shape.stroke]) {
            if (paint !== 'none') expect(paint).toBe('rgb(8, 8, 8)');
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

test('keeps Settings Specialists at named standard geometry at 100% and 200%', async ({ page }) => {
  await mountAvatarHost(page);
  const settings = page.locator('[data-settings-specialists]');
  const rows = settings.getByRole('button').filter({ has: page.locator('[data-agent-avatar]') });
  expect(await rows.count()).toBeGreaterThan(0);
  for (const zoom of [1, 2]) {
    await settings.evaluate((node, selectedZoom) => {
      (node as HTMLElement).style.zoom = String(selectedZoom);
    }, zoom);
    for (const avatar of await settings.locator('[data-agent-avatar]').all()) {
      await expect(avatar).toHaveAttribute('data-avatar-variant', 'standard');
      const [box, style] = await Promise.all([
        avatar.boundingBox(),
        avatar.evaluate((node) => {
          const computed = getComputedStyle(node);
          return { padding: computed.paddingLeft, boxSizing: computed.boxSizing };
        }),
      ]);
      expect(box?.width).toBeCloseTo(20 * zoom, 1);
      expect(box?.height).toBeCloseTo(20 * zoom, 1);
      expect(style).toEqual({ padding: '2px', boxSizing: 'border-box' });
    }
  }
});

test('matches each theme palette in the catalog at 20px and 200%', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountAvatarHost(page);
  const states = page
    .locator('[data-catalog-avatar-design="coordinator"]')
    .locator('.agent-avatar-catalog-states');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    expect(await catalogPalettePng(states, 1)).toMatchSnapshot(
      `agent-avatar-theme-palette-${theme}-20px.png`,
    );
    expect(await catalogPalettePng(states, 2)).toMatchSnapshot(
      `agent-avatar-theme-palette-${theme}-200-percent.png`,
    );
  }
});

test('matches the emphasized catalog stack in each theme at 100% and 200%', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountAvatarHost(page);
  const stack = page.locator('[data-agent-avatar-catalog-stack] [data-agent-avatar-stack]');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async (selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }, theme);
    await page.waitForTimeout(250);
    for (const scale of [1, 2] as const) {
      expect(await catalogStackPng(stack, scale)).toMatchSnapshot(
        `agent-avatar-stack-${theme}-${scale === 1 ? '100' : '200'}-percent.png`,
      );
    }
  }
});

test('shows the state surface in live panel-header and subscription consumers', async ({
  page,
}) => {
  await mountAvatarHost(page);
  const panelAvatar = page.locator('[data-live-panel-header] [data-agent-avatar-surface]');
  const subscriptionAvatar = page.locator(
    '[data-live-subscription-row] [data-agent-avatar-surface]',
  );
  await expect(panelAvatar).toHaveCount(2);
  await expect(panelAvatar.nth(0)).toHaveAttribute('data-avatar-state', 'running');
  await expect(panelAvatar.nth(1)).toHaveAttribute('data-avatar-state', 'unread');
  await expect(subscriptionAvatar).toHaveCount(1);
  await expect(subscriptionAvatar).toHaveAttribute('data-avatar-state', 'completed');
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((selectedTheme) => {
      document.documentElement.classList.toggle('dark', selectedTheme === 'dark');
      document.documentElement.classList.toggle('light', selectedTheme === 'light');
    }, theme);
    await page.waitForTimeout(250);
    for (const [avatar, family] of [
      [panelAvatar.nth(1), 'neutral'],
      [subscriptionAvatar, 'completed'],
    ] as const) {
      const presentation = await computedPresentation(avatar);
      expect(presentation.background[3]).toBe(255);
      expect(
        colorDistance(presentation.background, expectedSurfaceByTheme[theme][family]),
      ).toBeLessThanOrEqual(1);
    }
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
  expect(presentation.radius).toBe('6px');
  expect(presentation.outlineStyle).toBe('solid');
  expect(presentation.outlineWidth).toBe('1px');
  expect(presentation.outlineColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(presentation.pseudoContent).toBe('none');
  expect(presentation.pseudoWidth).toBe('0px');
  expect(presentation.clipPath).toContain(presentation.radius);
  expect(Number.parseFloat(presentation.transitionDuration)).toBeLessThan(0.001);
  await expect(avatar).toHaveAccessibleName(/discussion/i);
});
