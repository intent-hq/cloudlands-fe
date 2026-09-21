import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TOKEN_CSS = readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
const APP_LAYOUT_CSS = readFileSync(
  path.resolve(process.cwd(), 'src/routes/(app)/app-layout.css'),
  'utf8',
);
const ARTIFACT_DIR = process.env.APP_SHELL_ARTIFACT_DIR;

const fixture = `<style>
  ${TOKEN_CSS}
  ${APP_LAYOUT_CSS}
  * { box-sizing: border-box; }
  body { background: repeating-conic-gradient(#111827 0 25%, #f97316 0 50%) 0 / 96px 96px; }
  .panel-layout-container { display: grid; width: 100vw; height: 100vh; grid-template-rows: 48px minmax(0, 1fr); }
  [data-titlebar] { border-bottom: 1px solid hsl(var(--border)); }
  [data-frame] { display: grid; grid-template-columns: minmax(88px, 22%) minmax(0, 1fr); gap: 8px; padding: 8px; min-height: 0; }
  [data-sidebar] { color: hsl(var(--foreground)); padding: 12px; }
  [data-workspace] { min-width: 0; overflow: hidden; border: 1px solid hsl(var(--border)); border-radius: var(--radius-large); background: hsl(var(--sidebar)); padding: 16px; }
  [data-card] { background: hsl(var(--card)); color: hsl(var(--card-foreground)); padding: 12px; }
  [data-dialog] { background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); padding: 12px; }
  [data-editor] { background: rgb(18 33 43); color: white; padding: 12px; }
  button { height: 32px; }
  @media (max-width: 420px) { [data-frame] { grid-template-columns: 88px minmax(0, 1fr); } }
</style>
<main class="panel-layout-container" data-app-shell>
  <header data-titlebar>Product title bar</header>
  <div data-frame>
    <aside data-sidebar>Sidebar gutter</aside>
    <section data-workspace>
      <article data-card>Opaque card</article>
      <div data-dialog>Opaque dialog</div>
      <div data-editor>Custom editor</div>
      <button type="button">Interactive control</button>
    </section>
  </div>
</main>`;

type Scenario = {
  name: string;
  theme: 'light' | 'dark';
  physicalWidth: number;
  physicalHeight: number;
  zoom: number;
  forcedColors?: 'active';
};

async function render(page: Page, scenario: Scenario) {
  const cdp = await page.context().newCDPSession(page);
  const width = scenario.physicalWidth / scenario.zoom;
  const height = scenario.physicalHeight / scenario.zoom;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: scenario.zoom,
    mobile: false,
    screenWidth: scenario.physicalWidth,
    screenHeight: scenario.physicalHeight,
  });
  await page.emulateMedia({
    colorScheme: scenario.theme,
    forcedColors: scenario.forcedColors ?? 'none',
  });
  await page.setContent(fixture);
  await page.evaluate((theme) => (document.documentElement.className = theme), scenario.theme);
  return { cdp, width, height };
}

test('app shell wash stays isolated across themes, viewports, zoom, and forced colors', async ({
  page,
}) => {
  const scenarios: Scenario[] = [
    { name: 'light-wide-100', theme: 'light', physicalWidth: 1280, physicalHeight: 800, zoom: 1 },
    { name: 'dark-wide-100', theme: 'dark', physicalWidth: 1280, physicalHeight: 800, zoom: 1 },
    { name: 'light-narrow-100', theme: 'light', physicalWidth: 390, physicalHeight: 844, zoom: 1 },
    { name: 'dark-narrow-100', theme: 'dark', physicalWidth: 390, physicalHeight: 844, zoom: 1 },
    { name: 'light-wide-200', theme: 'light', physicalWidth: 1600, physicalHeight: 1000, zoom: 2 },
    { name: 'dark-wide-200', theme: 'dark', physicalWidth: 1600, physicalHeight: 1000, zoom: 2 },
    {
      name: 'light-forced-colors',
      theme: 'light',
      physicalWidth: 1280,
      physicalHeight: 800,
      zoom: 1,
      forcedColors: 'active',
    },
    {
      name: 'dark-forced-colors',
      theme: 'dark',
      physicalWidth: 1280,
      physicalHeight: 800,
      zoom: 1,
      forcedColors: 'active',
    },
  ];

  if (ARTIFACT_DIR) mkdirSync(ARTIFACT_DIR, { recursive: true });
  for (const scenario of scenarios) {
    const { cdp, width, height } = await render(page, scenario);
    const evidence = await page.evaluate(() => {
      const style = (selector: string, pseudo?: string) =>
        getComputedStyle(document.querySelector(selector)!, pseudo);
      const shell = document.querySelector<HTMLElement>('[data-app-shell]')!;
      const rect = shell.getBoundingClientRect();
      return {
        shell: style('[data-app-shell]').backgroundColor,
        forcedColors: matchMedia('(forced-colors: active)').matches,
        surfaces: {
          workspace: style('[data-workspace]').backgroundColor,
          sidebarToken: (() => {
            const probe = document.createElement('div');
            probe.style.backgroundColor = 'hsl(var(--sidebar))';
            document.body.append(probe);
            const color = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return color;
          })(),
          card: style('[data-card]').backgroundColor,
          dialog: style('[data-dialog]').backgroundColor,
          editor: style('[data-editor]').backgroundColor,
        },
        geometry: { width: rect.width, height: rect.height },
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        pointerTarget: document.elementFromPoint(
          ...(() => {
            const button = document.querySelector('button')!.getBoundingClientRect();
            return [button.x + button.width / 2, button.y + button.height / 2] as const;
          })(),
        )?.tagName,
        stacking: {
          zIndex: style('[data-app-shell]').zIndex,
          isolation: style('[data-app-shell]').isolation,
          transform: style('[data-app-shell]').transform,
          opacity: style('[data-app-shell]').opacity,
        },
        dragOverlay: {
          pointerEvents: style('[data-app-shell]', '::before').pointerEvents,
          height: style('[data-app-shell]', '::before').height,
        },
      };
    });

    expect(evidence.geometry, scenario.name).toEqual({ width, height });
    expect(evidence.overflow, scenario.name).toBeLessThanOrEqual(0);
    expect(evidence.pointerTarget, scenario.name).toBe('BUTTON');
    expect(evidence.stacking, scenario.name).toEqual({
      zIndex: 'auto',
      isolation: 'auto',
      transform: 'none',
      opacity: '1',
    });
    expect(evidence.dragOverlay, scenario.name).toEqual({ pointerEvents: 'none', height: '25px' });
    expect(evidence.surfaces.workspace, scenario.name).toBe(evidence.surfaces.sidebarToken);
    if (!scenario.forcedColors) {
      expect(evidence.forcedColors, scenario.name).toBe(false);
      expect(evidence.surfaces.editor, scenario.name).toBe('rgb(18, 33, 43)');
      expect(evidence.surfaces.card, scenario.name).not.toBe(evidence.shell);
      expect(evidence.surfaces.dialog, scenario.name).not.toBe(evidence.shell);
      expect(evidence.shell, scenario.name).toBe(
        scenario.theme === 'light' ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0)',
      );
    } else {
      expect(evidence.forcedColors, scenario.name).toBe(true);
    }
    if (ARTIFACT_DIR && scenario.name.endsWith('wide-200')) {
      const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: true,
        clip: { ...cssContentSize, scale: 1 },
      });
      writeFileSync(path.join(ARTIFACT_DIR, `${scenario.name}.png`), capture.data, 'base64');
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
});

test('keeps the semantic wash stable when Chromium exposes reduced transparency', async ({
  page,
}) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
  });
  await page.setContent(fixture);
  const evidence = await page.evaluate(() => {
    document.documentElement.className = 'light';
    return {
      supported: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      shell: getComputedStyle(document.querySelector('[data-app-shell]')!).backgroundColor,
    };
  });
  if (evidence.supported) expect(evidence.shell).toBe('rgba(255, 255, 255, 0.35)');
});

test('uses an opaque theme background without hiding the connection tint', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.setContent(fixture);
    const evidence = await page.evaluate((nextTheme) => {
      document.documentElement.className = nextTheme;
      const shell = document.querySelector<HTMLElement>('[data-app-shell]')!;
      shell.dataset.shellOpaque = '';
      shell.style.backgroundImage = 'linear-gradient(rgb(255 0 0 / 0.1), rgb(255 0 0 / 0.1))';
      const tokenProbe = document.createElement('div');
      tokenProbe.style.backgroundColor = 'hsl(var(--background))';
      document.body.append(tokenProbe);
      const result = {
        shellBackground: getComputedStyle(shell).backgroundColor,
        themeBackground: getComputedStyle(tokenProbe).backgroundColor,
        shellImage: getComputedStyle(shell).backgroundImage,
      };
      tokenProbe.remove();
      return result;
    }, theme);

    expect(evidence.shellBackground, theme).toBe(evidence.themeBackground);
    expect(evidence.shellImage, theme).not.toBe('none');
  }
});
