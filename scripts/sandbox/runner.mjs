const DEFAULT_SANDBOX_WIDTH = 720;
const DEFAULT_SANDBOX_TIMEOUT_MS = 30_000;

const THEMES = new Set(['light', 'dark', 'system']);
const MOTIONS = new Set(['reduced', 'full']);
const SCALES = new Set([1, 2]);

function debug(message) {
  if (process.env.SANDBOX_DEBUG) console.error(`sandbox: ${message}`);
}

function optionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function integerOption(flag, value, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--base-url must be a valid HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('--base-url must be a valid HTTP or HTTPS URL.');
  }
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function parseSandboxArgs(argv) {
  const scene = argv[0];
  if (!scene || scene.startsWith('--')) {
    throw new Error('A sandbox scene is required as the first argument.');
  }

  const options = {
    scene,
    theme: 'light',
    motion: 'reduced',
    width: DEFAULT_SANDBOX_WIDTH,
    scale: 1,
    timeout: DEFAULT_SANDBOX_TIMEOUT_MS,
    allowConsoleErrors: false,
  };
  const seen = new Set();

  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--allow-console-errors') {
      if (seen.has(flag)) throw new Error(`${flag} may only be specified once.`);
      seen.add(flag);
      options.allowConsoleErrors = true;
      continue;
    }
    if (
      ![
        '--state',
        '--theme',
        '--width',
        '--motion',
        '--scale',
        '--base-url',
        '--out',
        '--timeout',
      ].includes(flag)
    ) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (seen.has(flag)) throw new Error(`${flag} may only be specified once.`);
    seen.add(flag);
    const value = optionValue(argv, index, flag);
    index += 1;

    if (flag === '--state') options.state = value;
    if (flag === '--theme') {
      if (!THEMES.has(value)) throw new Error('--theme must be light, dark, or system.');
      options.theme = value;
    }
    if (flag === '--width') options.width = integerOption(flag, value, { min: 240, max: 1600 });
    if (flag === '--motion') {
      if (!MOTIONS.has(value)) throw new Error('--motion must be reduced or full.');
      options.motion = value;
    }
    if (flag === '--scale') {
      const scale = integerOption(flag, value, { min: 1, max: 2 });
      if (!SCALES.has(scale)) throw new Error('--scale must be 1 or 2.');
      options.scale = scale;
    }
    if (flag === '--base-url') options.baseUrl = normalizeBaseUrl(value);
    if (flag === '--out') options.out = value;
    if (flag === '--timeout') options.timeout = integerOption(flag, value);
  }

  if (!options.state) throw new Error('--state is required.');
  return options;
}

export function buildSandboxUrl(baseUrl, options) {
  const url = new URL(`sandbox/${encodeURIComponent(options.scene)}`, normalizeBaseUrl(baseUrl));
  url.searchParams.set('state', options.state);
  url.searchParams.set('theme', options.theme);
  url.searchParams.set('width', String(options.width));
  url.searchParams.set('motion', options.motion);
  url.searchParams.set('fit', 'component');
  return url.href;
}

async function startSandboxServer() {
  const previousEnvironment = {
    INTENT_UI_PREVIEW: process.env.INTENT_UI_PREVIEW,
    INTENT_BUILD_TARGET: process.env.INTENT_BUILD_TARGET,
  };
  process.env.INTENT_UI_PREVIEW = '1';
  process.env.INTENT_BUILD_TARGET = 'web';
  let server;

  const restoreEnvironment = () => {
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  try {
    debug('loading Vite');
    const { createServer } = await import('vite');
    debug('creating Vite server');
    server = await createServer({
      logLevel: 'error',
      server: { host: '127.0.0.1', strictPort: false, watch: { ignored: ['**/*'] } },
    });
    debug('starting Vite server');
    await server.listen();
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) throw new Error('Vite did not expose a local server URL.');
    let closed = false;
    return {
      baseUrl,
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await server.close();
        } finally {
          restoreEnvironment();
        }
      },
    };
  } catch (error) {
    if (server) await server.close().catch(() => {});
    restoreEnvironment();
    throw error;
  }
}

async function waitForSandboxPage(page, options, url, consoleErrors) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeout });
  await page.waitForFunction(() => Boolean(window.__INTENT_PREVIEW__), undefined, {
    timeout: options.timeout,
  });
  const availableStates = await page.evaluate(
    async (scene) => (await window.__INTENT_PREVIEW__?.states(scene)) ?? [],
    options.scene,
  );
  if (!availableStates.includes(options.state)) {
    const available = availableStates.length > 0 ? availableStates.join(', ') : '(none)';
    throw new Error(
      `Unknown state “${options.state}” for scene “${options.scene}”. Available states: ${available}.`,
    );
  }

  try {
    await page.locator('[data-preview-ready="true"]').waitFor({ timeout: options.timeout });
  } catch {
    throw new Error(
      `Timed out after ${options.timeout}ms waiting for scene “${options.scene}” state “${options.state}” to become ready.`,
    );
  }
  await waitForSandboxStability(page, options);

  if (!options.allowConsoleErrors && consoleErrors.length > 0) {
    throw new Error(`Page reported console errors:\n${consoleErrors.join('\n')}`);
  }
}

async function waitForSandboxStability(page, options) {
  try {
    await page.locator('[data-preview-stable="true"]').waitFor({ timeout: options.timeout });
  } catch {
    throw new Error(
      `Timed out after ${options.timeout}ms waiting for scene “${options.scene}” state “${options.state}” to become stable.`,
    );
  }
}

async function waitForResponsiveLayout(page, options) {
  await waitForSandboxStability(page, options);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

export async function runSandbox(options, action) {
  let server;
  let browser;
  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ??= Promise.allSettled([browser?.close(), server?.close()]);
    return cleanupPromise;
  };
  const handleInterrupt = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once('SIGINT', handleInterrupt);

  try {
    server = options.baseUrl ? undefined : await startSandboxServer();
    const baseUrl = options.baseUrl ?? server.baseUrl;
    const url = buildSandboxUrl(baseUrl, options);
    debug(`opening ${url}`);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
    debug('Chromium started');
    const context = await browser.newContext({
      viewport: { width: options.width, height: 900 },
      deviceScaleFactor: options.scale,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => consoleErrors.push(`page: ${error.message}`));
    await waitForSandboxPage(page, options, url, consoleErrors);
    debug('preview ready');
    const result = await action({
      page,
      url,
      consoleErrors,
      waitForStability: () => waitForResponsiveLayout(page, options),
    });
    await page.waitForTimeout(0);
    if (!options.allowConsoleErrors && consoleErrors.length > 0) {
      throw new Error(`Page reported console errors:\n${consoleErrors.join('\n')}`);
    }
    return result;
  } finally {
    process.removeListener('SIGINT', handleInterrupt);
    await cleanup();
  }
}
