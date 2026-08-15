import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { themePresets } from '../src/lib/utils/theme-presets';
import { parseVSCodeTheme, type VSCodeThemeJSON } from '../src/lib/utils/vscode-theme-parser';

const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test.use(existsSync(systemChrome) ? { channel: 'chrome' } : {});

const TOKEN_CSS = readFileSync(path.resolve(process.cwd(), 'src/lib/styles/tokens.css'), 'utf8');
const APP_HTML = readFileSync(path.resolve(process.cwd(), 'src/app.html'), 'utf8');
const THEME_BOOTSTRAP_SCRIPT = APP_HTML.match(
  /<script>\s*(\/\/ Apply theme immediately to prevent FOUC[\s\S]*?)<\/script>/,
)?.[1];
const FOUNDATION_ARTIFACT_DIR = process.env.FOUNDATION_ARTIFACT_DIR;
const ROLES = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'accent',
  'accent-foreground',
  'muted',
  'muted-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'info',
  'info-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
] as const;
const PAIRS = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['muted-foreground', 'muted'],
  ['destructive-foreground', 'destructive'],
  ['info-foreground', 'info'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
] as const;

function themeAuthorityFixture(): string {
  if (!THEME_BOOTSTRAP_SCRIPT) throw new Error('Missing first-frame theme bootstrap script');
  return `<!doctype html>
    <html><head><style>
      ${TOKEN_CSS}
      html, body { margin: 0; width: 100%; height: 100%; }
      #page { min-height: 100%; background: hsl(var(--background)); color: hsl(var(--foreground)); }
      #sidebar, #empty-panel { background: hsl(var(--sidebar)); color: hsl(var(--sidebar-foreground)); border: 1px solid hsl(var(--sidebar-border)); }
    </style><script>${THEME_BOOTSTRAP_SCRIPT}</script></head>
    <body><main id="page"><aside id="sidebar" class="bg-sidebar">Sidebar</aside><section id="empty-panel" class="bg-sidebar">Empty panel</section></main>
    <script>
      const media = matchMedia('(prefers-color-scheme: dark)');
      const resolveTheme = (theme) => theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      window.applyIntentTheme = (theme) => {
        localStorage.setItem('theme', theme);
        const resolved = resolveTheme(theme);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(resolved);
        document.documentElement.style.colorScheme = resolved;
      };
      window.captureThemeSurfaces = () => {
        const page = getComputedStyle(document.querySelector('#page'));
        const sidebar = getComputedStyle(document.querySelector('#sidebar'));
        const empty = getComputedStyle(document.querySelector('#empty-panel'));
        return { rootClass: document.documentElement.className, page: page.backgroundColor, sidebar: sidebar.backgroundColor, empty: empty.backgroundColor, border: sidebar.borderTopColor, foreground: sidebar.color };
      };
      window.__mountedThemeSurfaces = { page: document.querySelector('#page'), sidebar: document.querySelector('#sidebar'), empty: document.querySelector('#empty-panel') };
      window.__firstThemeSnapshot = window.captureThemeSurfaces();
      media.addEventListener('change', () => {
        if (localStorage.getItem('theme') === 'system') window.applyIntentTheme('system');
      });
    </script></body></html>`;
}

async function computedRoles(
  page: Page,
  className: string,
  variables: Record<string, string> = {},
): Promise<Record<string, string>> {
  await page.setContent(`<style>${TOKEN_CSS}</style><main id="probes"></main>`);
  return page.evaluate(
    ({ className, roles, variables }) => {
      document.documentElement.className = className;
      for (const [name, value] of Object.entries(variables)) {
        document.documentElement.style.setProperty(name, value);
      }
      const root = document.querySelector('#probes')!;
      return Object.fromEntries(
        roles.map((role) => {
          const probe = document.createElement('div');
          probe.style.backgroundColor = `hsl(var(--${role}))`;
          root.append(probe);
          return [role, getComputedStyle(probe).backgroundColor];
        }),
      );
    },
    { className, roles: ROLES, variables },
  );
}

function luminance(color: string): number {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  expect(channels, `browser did not compute ${color}`).toHaveLength(3);
  const [red, green, blue] = channels!.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function expectLegible(colors: Record<string, string>): void {
  for (const role of ROLES) expect(colors[role], role).toMatch(/^rgba?\(/);
  for (const [foreground, background] of PAIRS) {
    const values = [luminance(colors[foreground]), luminance(colors[background])].sort(
      (first, second) => second - first,
    );
    expect(
      (values[0] + 0.05) / (values[1] + 0.05),
      `${foreground} on ${background}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
  for (const control of ['input', 'ring'] as const) {
    for (const surface of ['background', 'card', 'popover', 'sidebar'] as const) {
      const values = [luminance(colors[control]), luminance(colors[surface])].sort(
        (first, second) => second - first,
      );
      expect(
        (values[0] + 0.05) / (values[1] + 0.05),
        `${control} on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
}

test('browser computes complete explicit light and dark contracts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await computedRoles(page, 'light');
  const dark = await computedRoles(page, 'dark');
  expectLegible(light);
  expectLegible(dark);

  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await computedRoles(page, 'light')).toEqual(light);
  await page.emulateMedia({ colorScheme: 'light' });
  expect(await computedRoles(page, 'dark')).toEqual(dark);
  for (const colors of [light, dark]) {
    expect(colors.border).not.toBe(colors.input);
    for (const surface of ['background', 'card', 'popover'] as const) {
      const values = [luminance(colors.border), luminance(colors[surface])].sort(
        (first, second) => second - first,
      );
      expect((values[0] + 0.05) / (values[1] + 0.05), `border on ${surface}`).toBeLessThan(2.25);
    }
  }
});

test('mounted theme authority matrix hydrates and switches sidebar surfaces without a flash', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await computedRoles(page, 'light');
  const dark = await computedRoles(page, 'dark');
  await page.addInitScript(() => {
    const fixtureWindow = window as typeof window & { __themeClassHistory?: string[] };
    const theme = new URL(location.href).searchParams.get('theme');
    if (theme) localStorage.setItem('theme', theme);
    fixtureWindow.__themeClassHistory = [];
    new MutationObserver(() => {
      fixtureWindow.__themeClassHistory?.push(document.documentElement.className);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });
  await page.route('http://theme.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: themeAuthorityFixture() }),
  );

  const matrix = [
    { preference: 'light', os: 'dark', resolved: 'light' },
    { preference: 'dark', os: 'light', resolved: 'dark' },
    { preference: 'system', os: 'light', resolved: 'light' },
    { preference: 'system', os: 'dark', resolved: 'dark' },
  ] as const;
  for (const state of matrix) {
    await page.emulateMedia({ colorScheme: state.os });
    await page.goto(`http://theme.test/?theme=${state.preference}`);
    const evidence = await page.evaluate(() => {
      const fixtureWindow = window as typeof window & {
        __firstThemeSnapshot: Record<string, string>;
        __themeClassHistory: string[];
        captureThemeSurfaces: () => Record<string, string>;
      };
      return {
        first: fixtureWindow.__firstThemeSnapshot,
        current: fixtureWindow.captureThemeSurfaces(),
        history: fixtureWindow.__themeClassHistory,
      };
    });
    const expected = state.resolved === 'dark' ? dark : light;
    expect(evidence.current, `${state.preference} on macOS ${state.os}`).toMatchObject({
      rootClass: state.resolved,
      page: expected.background,
      sidebar: expected.sidebar,
      empty: expected.sidebar,
      border: expected['sidebar-border'],
      foreground: expected['sidebar-foreground'],
    });
    expect(evidence.first).toEqual(evidence.current);
    expect(evidence.history).not.toContain(state.resolved === 'dark' ? 'light' : 'dark');
  }

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://theme.test/?theme=light&live=1');
  const switched = await page.evaluate(() => {
    const fixtureWindow = window as typeof window & {
      __mountedThemeSurfaces: Record<string, Element>;
      applyIntentTheme: (theme: string) => void;
      captureThemeSurfaces: () => Record<string, string>;
    };
    const mounted = fixtureWindow.__mountedThemeSurfaces;
    fixtureWindow.applyIntentTheme('dark');
    return {
      sameNodes:
        mounted.page === document.querySelector('#page') &&
        mounted.sidebar === document.querySelector('#sidebar') &&
        mounted.empty === document.querySelector('#empty-panel'),
      colors: fixtureWindow.captureThemeSurfaces(),
    };
  });
  expect(switched.sameNodes).toBe(true);
  expect(switched.colors).toMatchObject({ sidebar: dark.sidebar, empty: dark.sidebar });

  await page.evaluate(() => {
    (window as typeof window & { applyIntentTheme: (theme: string) => void }).applyIntentTheme(
      'system',
    );
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(() => page.evaluate(() => document.documentElement.className)).toBe('light');
});

test('browser computes every preset and sparse imported high-contrast theme', async ({ page }) => {
  const imported: VSCodeThemeJSON = {
    name: 'Sparse high contrast',
    type: 'hc-black',
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#111111',
      focusBorder: '#ffff00',
      'terminal.background': '#010203',
    },
  };
  const contrastingSidebar: VSCodeThemeJSON = {
    name: 'Sparse contrasting sidebar',
    type: 'light',
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#111111',
      'sideBar.background': '#000000',
    },
  };
  const themes = [
    ...themePresets.flatMap((preset) => [preset.light, preset.dark]),
    imported,
    contrastingSidebar,
  ];

  for (const theme of themes) {
    const parsed = parseVSCodeTheme(theme);
    const colors = await computedRoles(page, '', parsed.cssVariables);
    expectLegible(colors);
    expect(colors.background).not.toBe('rgb(1, 2, 3)');
    expect(colors.background).toBe(
      await computedRoles(page, parsed.type, parsed.cssVariables).then((roles) => roles.background),
    );
  }

  const contrasting = parseVSCodeTheme(contrastingSidebar);
  const colors = await computedRoles(page, '', contrasting.cssVariables);
  expect(colors.border).toBe('rgb(230, 230, 230)');
  expect(colors['sidebar-border']).toBe('rgb(26, 26, 26)');
  expect(colors.border).not.toBe(colors['sidebar-border']);
});

test('browser resolves the semantic hatch and compact foundation geometry in both modes', async ({
  page,
}) => {
  for (const className of ['light', 'dark']) {
    await page.setContent(`<style>${TOKEN_CSS}</style><main id="probe"></main>`);
    const foundations = await page.evaluate((mode) => {
      document.documentElement.className = mode;
      const style = getComputedStyle(document.documentElement);
      return {
        hatch: style.getPropertyValue('--surface-hatch').trim(),
        compactControl: style.getPropertyValue('--control-height-compact').trim(),
        smallControl: style.getPropertyValue('--control-height-small').trim(),
        mediumControl: style.getPropertyValue('--control-height-medium').trim(),
        largeControl: style.getPropertyValue('--control-height-large').trim(),
        smallRadius: style.getPropertyValue('--radius-small').trim(),
        mediumRadius: style.getPropertyValue('--radius-medium').trim(),
        largeRadius: style.getPropertyValue('--radius-large').trim(),
      };
    }, className);
    expect(foundations.hatch).toContain('repeating-linear-gradient');
    expect(foundations.hatch).toMatch(/hsl\(/g);
    expect(foundations).toMatchObject({
      compactControl: '1.75rem',
      smallControl: '1.75rem',
      mediumControl: '2rem',
      largeControl: '2.25rem',
      smallRadius: '5px',
      mediumRadius: '7px',
      largeRadius: '9px',
    });
  }
});

test('standalone foundations contact sheet stays readable across required modes', async ({
  context,
  page,
}) => {
  const contactSheet = `
    <style>
      ${TOKEN_CSS}
      * { box-sizing: border-box; }
      body { margin: 0; background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: var(--font-ui); font-size: var(--text-body-size); line-height: var(--text-body-line-height); }
      main { width: min(calc(100% - 2rem), var(--content-measure-wide)); margin: 0 auto; padding: var(--space-6) 0; }
      header { display: flex; justify-content: space-between; gap: var(--space-4); align-items: end; margin-bottom: var(--space-5); }
      h1 { margin: 0; font-size: var(--text-display-large-size); line-height: var(--text-display-large-line-height); font-weight: var(--text-display-large-weight); letter-spacing: var(--text-display-large-tracking); }
      p { margin: 0; color: hsl(var(--muted-foreground)); }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
      section { min-width: 0; border: 1px solid hsl(var(--border)); border-radius: var(--radius-large); background: hsl(var(--card)); color: hsl(var(--card-foreground)); box-shadow: var(--elevation-raised); padding: var(--space-4); }
      h2 { margin: 0 0 var(--space-3); font-size: var(--text-title-size); line-height: var(--text-title-line-height); font-weight: var(--text-title-weight); letter-spacing: var(--text-title-tracking); }
      .swatches { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--space-2); }
      .swatch { min-height: 4.5rem; border: 1px solid hsl(var(--border)); border-radius: var(--radius-medium); padding: var(--space-2); font-size: var(--text-caption-size); line-height: var(--text-caption-line-height); font-weight: var(--text-caption-weight); }
      .background { background: hsl(var(--background)); color: hsl(var(--foreground)); }
      .card { background: hsl(var(--card)); color: hsl(var(--card-foreground)); }
      .primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
      .accent { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
      .muted { background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }
      .info { background: hsl(var(--info)); color: hsl(var(--info-foreground)); }
      .success { background: hsl(var(--success)); color: hsl(var(--success-foreground)); }
      .sidebar { background: hsl(var(--sidebar)); color: hsl(var(--sidebar-foreground)); }
      .samples { display: grid; gap: var(--space-2); }
      .display { font-size: var(--text-display-size); line-height: var(--text-display-line-height); font-weight: var(--text-display-weight); }
      .label { font-size: var(--text-label-size); line-height: var(--text-label-line-height); font-weight: var(--text-label-weight); letter-spacing: var(--text-label-tracking); }
      code { font-family: var(--font-code); font-size: var(--text-code-size); line-height: var(--text-code-line-height); }
      .geometry { display: flex; align-items: end; gap: var(--space-2); flex-wrap: wrap; }
      .control { display: inline-flex; align-items: center; justify-content: center; border: 1px solid hsl(var(--input)); border-radius: var(--radius-medium); background: hsl(var(--popover)); color: hsl(var(--popover-foreground)); padding: 0 var(--space-3); box-shadow: var(--elevation-raised); }
      .small { height: var(--control-height-small); } .medium { height: var(--control-height-medium); } .large { height: var(--control-height-large); }
      .hatch { min-height: 7rem; border: 1px solid hsl(var(--border)); border-radius: var(--radius-large); background-image: var(--surface-hatch); }
      .motion { width: 2.25rem; height: 2.25rem; border-radius: var(--radius-full); background: hsl(var(--info)); transition: transform var(--motion-standard) var(--ease-standard); animation: pulse var(--motion-slow) var(--ease-standard) infinite alternate; }
      @keyframes pulse { to { transform: translateX(1rem); } }
      @media (max-width: 44rem) { main { padding: var(--space-4) 0; } header { align-items: start; flex-direction: column; } .grid { grid-template-columns: 1fr; } .swatches { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    </style>
    <main>
      <header><div><h1>Semantic foundations</h1><p>Operate-inspired editorial system</p></div><code>012-A · light / dark / system</code></header>
      <div class="grid">
        <section><h2>Color roles</h2><div class="swatches"><div class="swatch background">Canvas</div><div class="swatch card">Raised</div><div class="swatch primary">Primary</div><div class="swatch accent">Selection</div><div class="swatch muted">Muted</div><div class="swatch info">Info</div><div class="swatch success">Success</div><div class="swatch sidebar">Chrome</div></div></section>
        <section><h2>Typography</h2><div class="samples"><div class="display">Editorial hierarchy</div><div>Readable body copy stays regular and compact.</div><div class="label">Medium label · sentence case</div><code>const role = 'semantic';</code></div></section>
        <section><h2>Geometry & elevation</h2><div class="geometry"><span class="control small">28px</span><span class="control medium">32px</span><span class="control large">36px</span></div></section>
        <section><h2>Hatched surface</h2><div class="hatch" data-hatch></div></section>
        <section><h2>Motion & layers</h2><div class="motion" data-motion></div></section>
      </div>
    </main>`;
  const cases = [
    ['light-desktop', 'light', 1280, 800, 'no-preference', 1],
    ['dark-desktop', 'dark', 1280, 800, 'no-preference', 1],
    ['light-compact', 'light', 390, 844, 'no-preference', 1],
    ['dark-compact', 'dark', 390, 844, 'no-preference', 1],
    ['light-zoom-200', 'light', 1280, 800, 'no-preference', 2],
    ['dark-zoom-200', 'dark', 1280, 800, 'no-preference', 2],
    ['light-reduced-motion', 'light', 1280, 800, 'reduce', 1],
    ['dark-reduced-motion', 'dark', 1280, 800, 'reduce', 1],
  ] as const;
  if (FOUNDATION_ARTIFACT_DIR) mkdirSync(FOUNDATION_ARTIFACT_DIR, { recursive: true });
  const cdp = await context.newCDPSession(page);
  for (const [name, mode, physicalWidth, physicalHeight, reducedMotion, zoom] of cases) {
    const width = physicalWidth / zoom;
    const height = physicalHeight / zoom;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: zoom,
      mobile: false,
      screenWidth: physicalWidth,
      screenHeight: physicalHeight,
    });
    await page.emulateMedia({ colorScheme: mode, reducedMotion });
    await page.setContent(contactSheet);
    await page.evaluate((className) => {
      document.documentElement.className = className;
    }, mode);
    const evidence = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      hatch: getComputedStyle(document.querySelector('[data-hatch]')!).backgroundImage,
      transition: getComputedStyle(document.querySelector('[data-motion]')!).transitionDuration,
      animation: getComputedStyle(document.querySelector('[data-motion]')!).animationDuration,
      devicePixelRatio: window.devicePixelRatio,
      viewportWidth: document.documentElement.clientWidth,
      headingCssHeight: document.querySelector('h1')!.getBoundingClientRect().height,
    }));
    expect(evidence.overflow, name).toBeLessThanOrEqual(0);
    expect(evidence.hatch, name).toContain('repeating-linear-gradient');
    expect(evidence.viewportWidth, name).toBe(width);
    if (reducedMotion === 'reduce') {
      expect(['0.01ms', '1e-05s'], name).toContain(evidence.transition);
      expect(['0.01ms', '1e-05s'], name).toContain(evidence.animation);
    }
    if (zoom === 2) {
      expect(evidence.devicePixelRatio, name).toBe(2);
      expect(evidence.viewportWidth, name).toBe(physicalWidth / 2);
      expect(evidence.headingCssHeight * evidence.devicePixelRatio, name).toBeGreaterThanOrEqual(
        64,
      );
    }
    if (FOUNDATION_ARTIFACT_DIR || zoom === 2) {
      const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
      const capture = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
        fromSurface: true,
        clip: { ...cssContentSize, scale: 1 },
      });
      const screenshot = Buffer.from(capture.data, 'base64');
      expect(screenshot.readUInt32BE(16), name).toBe(physicalWidth);
      if (FOUNDATION_ARTIFACT_DIR) {
        writeFileSync(path.join(FOUNDATION_ARTIFACT_DIR, `${name}.png`), screenshot);
      }
    }
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
});
