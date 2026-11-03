// Pure helpers for scripts/headless-electron.mjs: argument parsing, the
// virtual-display decision, and the Electron launch options. Kept free of
// Electron/Playwright imports so they are unit-testable.
import path from 'node:path';

export { resolveIntentdSocketPath } from './vite-plugin-intentd-bridge.mjs';

export const DEFAULT_ROUTE = '/';
export const DEFAULT_SETTLE_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_OUT_DIR = path.join('e2e-reports', 'headless-electron');
const XVFB_SCREEN = '1440x900x24';
// Set on the re-executed child so it never re-wraps itself in another xvfb-run.
export const XVFB_MARKER = 'INTENT_HEADLESS_ELECTRON_XVFB';
// Production renderer origin (see buildLoadUrl in src/main/window.ts).
const APP_ORIGIN = 'app://workspaces';

export const USAGE = `Usage: pnpm run electron:headless -- [options]

Launch the built desktop app (run \`pnpm run build\` first) with a throwaway profile,
connected to an existing daemon, open a route and save a screenshot. On Linux without
a display it re-runs itself under \`xvfb-run -a\`.

Options:
  --route <path>       Renderer route to open (default: /), e.g. '/settings?tab=devices'
  --out <file.png>     Screenshot path (default: ${DEFAULT_OUT_DIR}/<route>-<time>.png)
  --socket <path>      Daemon socket (default: INTENTD_SOCKET, else the platform default)
  --wait-for <css>     Wait for this selector to be visible before the screenshot
  --settle-ms <n>      Extra wait after the route renders (default: ${DEFAULT_SETTLE_MS})
  --timeout-ms <n>     Budget for launch and each wait (default: ${DEFAULT_TIMEOUT_MS})
  --check <module>     ES module whose default export async ({ app, page, route }) => void
                       runs after the screenshot; a throw fails the run (exit 1)
  --keep-profile       Keep the throwaway profile directory and print its path
  -h, --help           Show this help
`;

export class UsageError extends Error {}

function parsePositiveInt(flag, raw) {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UsageError(`${flag} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Parse CLI flags. Accepts both `--flag value` and `--flag=value`. */
export function parseHeadlessArgs(argv) {
  const options = {
    route: DEFAULT_ROUTE,
    out: null,
    socket: null,
    waitFor: null,
    settleMs: DEFAULT_SETTLE_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    check: null,
    keepProfile: false,
    help: false,
  };
  const valued = {
    '--route': 'route',
    '--out': 'out',
    '--socket': 'socket',
    '--wait-for': 'waitFor',
    '--settle-ms': 'settleMs',
    '--timeout-ms': 'timeoutMs',
    '--check': 'check',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // pnpm forwards a literal `--` separator on some versions; ignore it.
    if (arg === '--') continue;
    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--keep-profile') {
      options.keepProfile = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const key = valued[flag];
    if (!key) throw new UsageError(`Unknown argument: ${arg}`);
    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${flag} requires a value`);
      }
      i += 1;
    }
    options[key] =
      key === 'settleMs' || key === 'timeoutMs' ? parsePositiveInt(flag, value) : value;
  }
  if (!options.route.startsWith('/')) {
    throw new UsageError(`--route must start with "/", got ${JSON.stringify(options.route)}`);
  }
  return options;
}

/** `app://workspaces/settings?tab=devices` for route `/settings?tab=devices`. */
export function routeUrl(route) {
  return `${APP_ORIGIN}${route}`;
}

/** File-name-safe slug of a route: `/settings?tab=devices` → `settings-tab-devices`. */
export function routeSlug(route) {
  const slug = route
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'home';
}

export function defaultScreenshotPath(cwd, route, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.resolve(cwd, DEFAULT_OUT_DIR, `${routeSlug(route)}-${stamp}.png`);
}

/**
 * Linux needs a virtual display when neither X11 nor Wayland is available.
 * The marker prevents the xvfb-run child from wrapping itself again.
 */
export function needsVirtualDisplay(platform = process.platform, env = process.env) {
  if (platform !== 'linux') return false;
  if (env[XVFB_MARKER] === '1') return false;
  return !env.DISPLAY?.trim() && !env.WAYLAND_DISPLAY?.trim();
}

/** Command that re-runs this script under a fresh virtual display. */
export function xvfbCommand(nodePath, scriptPath, argv) {
  return {
    command: 'xvfb-run',
    args: ['-a', `--server-args=-screen 0 ${XVFB_SCREEN}`, nodePath, scriptPath, ...argv],
  };
}

// Variables that would turn Electron into plain Node, point the app at a dev
// renderer or another backend, or reuse the developer's CDP port.
const STRIPPED_ENV = [
  'ELECTRON_RUN_AS_NODE',
  'DEV_PORT',
  'DEV_INSTANCE',
  'ENABLE_CDP_DEBUG',
  'INTENTD_BIN',
  'INTENTD_DATA_DIR',
  'INTENTD_WS_URL',
  'INTENTD_TCP',
  'INTENTD_TCP_PORT',
  'INTENTD_TCP_INSECURE',
];

/**
 * Options for Playwright's `_electron.launch`. `INTENTD_SOCKET` makes the app
 * connect to the existing daemon instead of spawning a sidecar, and
 * `--user-data-dir` (honored by resolveUserDataBasePath) isolates every
 * store, session and singleton lock from the developer's real profile.
 */
export function electronLaunchOptions({ appDir, userDataDir, socket, env = process.env }) {
  if (!path.isAbsolute(userDataDir)) throw new Error('userDataDir must be absolute');
  const childEnv = { ...env };
  for (const key of STRIPPED_ENV) delete childEnv[key];
  return {
    args: ['.', `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: appDir,
    env: { ...childEnv, NODE_ENV: 'production', INTENTD_SOCKET: socket },
  };
}
