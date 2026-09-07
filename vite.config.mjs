import { sveltekit } from '@sveltejs/kit/vite';
import { compile, paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { intentdBridgePlugin } from './scripts/vite-plugin-intentd-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json for __APP_VERSION__
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const paraglideProject = join(__dirname, 'project.inlang');
const paraglideOutdir = join(__dirname, 'src/shared/paraglide');
const messagesDir = join(__dirname, 'messages');
const normalizeWatcherPath = (file) => file.replace(/\\/g, '/');

function canReuseGeneratedParaglide() {
  const outputs = ['messages.js', 'runtime.js'].map((file) => join(paraglideOutdir, file));
  if (outputs.some((file) => !existsSync(file))) return false;

  const inputs = [
    join(paraglideProject, 'settings.json'),
    ...readdirSync(messagesDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => join(messagesDir, file)),
  ];
  const newestInput = Math.max(...inputs.map((file) => statSync(file).mtimeMs));
  const oldestOutput = Math.min(...outputs.map((file) => statSync(file).mtimeMs));
  return oldestOutput >= newestInput;
}

const reuseGeneratedParaglide = () => ({
  name: 'reuse-generated-paraglide',
  enforce: 'pre',
  buildStart() {
    this.addWatchFile(messagesDir);
    this.addWatchFile(join(paraglideProject, 'settings.json'));
  },
  async watchChange(file) {
    const normalizedFile = normalizeWatcherPath(file);
    const normalizedMessagesDir = normalizeWatcherPath(messagesDir);
    const normalizedProjectSettings = normalizeWatcherPath(join(paraglideProject, 'settings.json'));
    const isMessage =
      normalizedFile.startsWith(`${normalizedMessagesDir}/`) && normalizedFile.endsWith('.json');
    const isProjectSettings = normalizedFile === normalizedProjectSettings;
    if (!isMessage && !isProjectSettings) return;

    await compile({
      project: paraglideProject,
      outdir: paraglideOutdir,
      outputStructure: 'locale-modules',
      cleanOutdir: false,
      isServer: "import.meta.env?.SSR ?? typeof window === 'undefined'",
    });
  },
});

// Node modules that should be excluded from browser bundle
// These are dependencies of electron-store that use Node.js APIs
const nodeOnlyModules = ['electron-store', 'conf', 'atomically', 'stubborn-fs', 'stubborn-utils'];

const EMPTY_MODULE = `
  // This module was excluded because it uses Node.js-only APIs
  // Main process code cannot run in the browser
  export default {};
  export const __empty = true;
`;

/**
 * Check if a path points to Node.js-only code that should be excluded from browser bundle.
 *
 * Architecture: All Node.js-only code lives in /main/ subdirectories:
 *   - features/workspace/main/  - workspace Node.js services
 *   - features/agent/main/      - agent Node.js services
 *   - features/mcp/main/        - MCP Node.js code
 *   - etc.
 *
 * This convention makes it easy to identify and exclude main process code.
 */
function isNodeOnlyPath(pathStr) {
  const normalizedPath = pathStr.replace(/\\/g, '/');

  // Exclude everything in /main/ subdirectories
  // This is the primary mechanism for separating main process code
  if (normalizedPath.includes('/main/')) {
    return true;
  }

  // Exclude specific node_modules that use Node.js APIs
  for (const mod of nodeOnlyModules) {
    if (normalizedPath.includes(`/node_modules/${mod}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Plugin to prevent HMR page reloads when .svelte-kit/generated files change.
 *
 * SvelteKit periodically regenerates its internal files, which triggers Vite's HMR
 * to do a full page reload. This breaks the SvelteKit router, causing blank pages
 * and "Not found" errors.
 *
 * This plugin intercepts HMR updates for .svelte-kit files and prevents them from
 * triggering page reloads. Instead, it logs the event for debugging.
 */
const preventSvelteKitRegenHMR = () => ({
  name: 'prevent-sveltekit-regen-hmr',
  // Run before other plugins to intercept HMR early
  enforce: 'pre',
  // eslint-disable-next-line no-unused-vars
  handleHotUpdate({ file, server }) {
    const normalizedFile = file.replace(/\\/g, '/');
    // Block ordinary HMR updates for anything inside nested .intent isolated worktrees
    // (monorepo#3150). The primary fix is the '**/.intent/**' server.watch.ignored
    // pattern; this backstops plain HMR events only — it cannot intercept Vite's
    // tsconfig cache-clear/full-reload path, which fires from watcher events in core
    // before any plugin's handleHotUpdate runs.
    if (normalizedFile.includes('/.intent/')) {
      console.log(
        `[HMR-BLOCKED] Prevented reload for nested .intent worktree file: ${normalizedFile}`,
      );
      return [];
    }
    // Block HMR for .svelte-kit/generated and .svelte-kit/types files
    if (
      normalizedFile.includes('.svelte-kit/generated') ||
      normalizedFile.includes('.svelte-kit/types')
    ) {
      console.log(
        `[HMR-BLOCKED] Prevented page reload for: ${normalizedFile.split('.svelte-kit/')[1]}`,
      );
      // Return empty array to prevent HMR from processing this file
      return [];
    }
    // Block HMR for non-source files that can't be hot-updated and would trigger
    // a full page reload, destroying in-flight state (e.g. workspace creation navigation).
    // This is a safety net in case the server.watch.ignored patterns don't catch everything.
    const basename = normalizedFile.split('/').pop() || '';
    const isTestOnlyFile =
      /\.(test|spec)\.[^/]+$/.test(basename) ||
      normalizedFile.includes('/__tests__/') ||
      normalizedFile.includes('/__mocks__/') ||
      normalizedFile.includes('/tests/') ||
      normalizedFile.includes('/test/');
    if (
      isTestOnlyFile ||
      basename === 'package.json' ||
      basename === 'pnpm-lock.yaml' ||
      basename === 'package-lock.json' ||
      basename === 'log.txt' ||
      normalizedFile.includes('/test-reports/')
    ) {
      console.log(`[HMR-BLOCKED] Prevented page reload for non-source file: ${basename}`);
      return [];
    }
    return undefined; // Let other files be handled normally
  },
});

/**
 * Plugin to handle unhandled SvelteKit virtual modules.
 *
 * SvelteKit's Vite plugin resolves `__sveltekit/*` to `\0virtual:__sveltekit/*`,
 * but only handles specific modules (environment, server, manifest, remote).
 * If any other `__sveltekit/*` module is imported (e.g., during HMR), Vite will
 * try to read it as a file, which fails because the path contains null bytes.
 *
 * This plugin catches any unhandled `__sveltekit/*` modules and provides a fallback.
 */
const handleUnhandledSvelteKitModules = () => ({
  name: 'handle-unhandled-sveltekit-modules',
  // Run after SvelteKit plugin so we only catch modules it didn't handle
  enforce: 'post',

  load(id) {
    // Handle any __sveltekit/* virtual modules that weren't handled by SvelteKit
    // This prevents Vite from trying to read files with null bytes in the path
    if (id.startsWith('\0virtual:__sveltekit/')) {
      const moduleName = id.replace('\0virtual:__sveltekit/', '');
      console.warn(
        `[handle-unhandled-sveltekit-modules] Providing fallback for unhandled module: __sveltekit/${moduleName}`,
      );

      // Provide appropriate fallback based on module name
      if (moduleName === 'paths') {
        return `
          export const base = '';
          export const assets = '';
          export const relative = false;
        `;
      }

      // Generic fallback for any other unhandled modules
      return 'export default {};';
    }
    return null;
  },
});

/**
 * Dev-only middleware that answers `GET /health` with a plain 404 before
 * SvelteKit's handler runs.
 *
 * The MCP bridge scanner probes ports 5179–5188 for a `/health` responder
 * during startup and reconnect. When the Vite dev server happens to bind
 * inside (or adjacent to) that range, each probe would otherwise be routed
 * to SvelteKit's route handler and logged as a red `[404] GET /health`
 * line. Answering the probe here — as fast, opaque 404s — keeps the dev
 * console clean regardless of which port the renderer runs on. The scanner
 * still treats the response as "not a bridge" because the `text/plain`
 * body (`not-a-bridge`) does not match a bridge response.
 */
const devHealthProbeSilencer = () => ({
  name: 'dev-health-probe-silencer',
  apply: 'serve',
  configureServer(server) {
    // Registering here (without returning a post-hook) inserts the middleware
    // BEFORE Vite's built-in and SvelteKit's handlers, so probes never reach
    // the SvelteKit router.
    server.middlewares.use('/health', (req, res) => {
      if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end();
        return;
      }
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('X-Dev-Health-Silencer', '1');
      res.end('not-a-bridge\n');
    });
  },
});

// Custom plugin to exclude Node.js-only files from browser bundle
const excludeNodeModules = () => ({
  name: 'exclude-node-modules',
  // Run before other plugins to ensure we don't interfere with virtual modules
  enforce: 'pre',
  resolveId(source, _importer, options) {
    // Never intercept virtual modules (they start with \0 or virtual:)
    // This MUST be checked first, before any other logic
    if (
      source.startsWith('\0') ||
      source.startsWith('virtual:') ||
      source.includes('__sveltekit')
    ) {
      return null;
    }

    // Skip during SSR/build
    if (options?.ssr) return null;

    if (isNodeOnlyPath(source)) {
      return '\0virtual:empty-module';
    }

    return null;
  },
  load(id, options) {
    // Return empty module for our own virtual module
    if (id === '\0virtual:empty-module') {
      return EMPTY_MODULE;
    }

    // Never process other virtual modules (they start with \0)
    // This is critical for SvelteKit's virtual modules like __sveltekit/paths
    // Also check for __sveltekit in the path as an extra safety measure
    if (id.startsWith('\0') || id.includes('__sveltekit')) {
      return null;
    }

    // Skip during SSR
    if (options?.ssr) return null;

    // Check if this is a resolved path to a node-only file
    if (isNodeOnlyPath(id)) {
      return EMPTY_MODULE;
    }

    return null;
  },
});

export default defineConfig(({ command, mode, isPreview }) => {
  // Web profile: `INTENT_BUILD_TARGET=web` (set by the dev:web / build:web
  // scripts) builds the renderer for a plain browser — no Electron main or
  // preload. svelte.config.js switches the adapter output to dist/web for the
  // same flag. Production gets its live daemon URL from /runtime-config.js so
  // credentials never enter immutable application chunks. VITE_INTENTD_WS_URL
  // remains a dev:web convenience; without either URL the app uses the mock.
  const isWebBuild = process.env.INTENT_BUILD_TARGET === 'web';
  const isUiPreview = command === 'serve' && process.env.INTENT_UI_PREVIEW === '1';
  const intentdBridgeRequested =
    command === 'serve' && !isPreview && isWebBuild && process.env.INTENT_DEV_DAEMON_BRIDGE === '1';
  const useIntentdBridge = intentdBridgeRequested && process.platform !== 'win32';
  const useBundledMessages = mode === 'production';
  const i18nVirtualMessages = '\0intent-paraglide-messages';
  const i18nVirtualRuntime = '\0intent-paraglide-runtime';
  const env = loadEnv(mode, __dirname, '');

  const webDefines = {};
  const isProductionWebBuild = isWebBuild && mode === 'production';
  const browserWsUrl = env.VITE_INTENTD_WS_URL || (useIntentdBridge ? '/intentd/ws' : '');
  const hasBuildTimeBrowserWsUrl = !isProductionWebBuild && Boolean(browserWsUrl);
  if (isWebBuild && !hasBuildTimeBrowserWsUrl && env.VITE_ENABLE_BROWSER_MOCK === undefined) {
    // Production web builds are gated out of the browser mock by default
    // (hooks.client.ts only loads it in DEV or under an explicit opt-in).
    // Default the opt-in ON for web builds with no daemon WS URL configured,
    // so `build:web` output boots standalone on mock data. An explicit
    // VITE_ENABLE_BROWSER_MOCK or a development VITE_INTENTD_WS_URL wins. A
    // production runtime URL still overrides the installed mock transport.
    webDefines['import.meta.env.VITE_ENABLE_BROWSER_MOCK'] = JSON.stringify('true');
  }

  return {
    // Plugin order:
    // 1. paraglideVitePlugin() - compiles messages/{locale}.json into src/shared/paraglide (typed m.* functions)
    // 2. devHealthProbeSilencer() - dev-only: absorbs /health probes from the MCP bridge scanner before SvelteKit sees them
    // 3. preventSvelteKitRegenHMR() - blocks HMR page reloads for .svelte-kit/generated files
    // 4. sveltekit() - SvelteKit's virtual modules and SSR handling
    // 5. handleUnhandledSvelteKitModules() - catches any __sveltekit/* modules not handled by SvelteKit
    // 6. excludeNodeModules() - excludes Node.js-only code from browser bundle
    plugins: [
      {
        name: 'use-production-paraglide-bundle',
        enforce: 'pre',
        resolveId(source) {
          if (useBundledMessages && source.endsWith('/paraglide/messages.js')) {
            return i18nVirtualMessages;
          }
          if (useBundledMessages && source.endsWith('/paraglide/runtime.js')) {
            return i18nVirtualRuntime;
          }
          return null;
        },
        load(id) {
          if (id === i18nVirtualMessages) {
            return (
              'const i18n = globalThis.__INTENT_PARAGLIDE_I18N__;\n' +
              'if (!i18n) throw new Error("Paraglide production bundle was not loaded");\n' +
              'export const m = i18n.m;\n'
            );
          }
          if (id === i18nVirtualRuntime) {
            return `
              const runtime = globalThis.__INTENT_PARAGLIDE_I18N__.runtime;
              export const baseLocale = runtime.baseLocale;
              export const locales = runtime.locales;
              export const overwriteGetLocale = (...args) => runtime.overwriteGetLocale(...args);
              export const getLocale = (...args) => runtime.getLocale(...args);
              export const setLocale = (...args) => runtime.setLocale(...args);
              export const getTextDirection = (...args) => runtime.getTextDirection(...args);
              export const isLocale = (...args) => runtime.isLocale(...args);
              export const toLocale = (...args) => runtime.toLocale(...args);
              export const localizeHref = (...args) => runtime.localizeHref(...args);
            `;
          }
          return null;
        },
      },
      isUiPreview && canReuseGeneratedParaglide()
        ? reuseGeneratedParaglide()
        : paraglideVitePlugin({
            project: paraglideProject,
            outdir: paraglideOutdir,
            // The app-wide `m` namespace uses nearly the complete catalog. Emitting one
            // module per message creates 5k+ Rollup nodes without useful tree-shaking;
            // locale modules keep the same runtime contract with a bounded build graph.
            outputStructure: 'locale-modules',
          }),
      devHealthProbeSilencer(),
      intentdBridgeRequested && intentdBridgePlugin(),
      preventSvelteKitRegenHMR(),
      sveltekit(),
      handleUnhandledSvelteKitModules(),
      excludeNodeModules(),
    ].filter(Boolean),

    // Electron-specific configuration
    // Use absolute paths since we use the app:// protocol which serves from a consistent root
    // This prevents refresh issues on nested routes like /workspace/abc123
    base: '/',

    // Worker configuration for Monaco Editor
    worker: {
      format: 'es',
    },

    build: {
      // Generate sourcemaps: 'hidden' in production (not exposed publicly),
      // true in development for debugging. INTENT_DISABLE_SOURCEMAPS=1
      // (exactly '1') skips them entirely — sourcemap generation multiplies
      // rollup's peak heap, and CI smoke builds (Build (web)) never consume
      // the maps (monorepo#1074).
      sourcemap:
        process.env.INTENT_DISABLE_SOURCEMAPS === '1'
          ? false
          : process.env.NODE_ENV === 'development'
            ? true
            : 'hidden',
      rollupOptions: {
        external: [
          'electron',
          'fs',
          'path',
          'os',
          'crypto',
          'stream',
          'util',
          'events',
          'child_process',
          // Native modules (cannot be bundled)
          'node-pty',
          'ssh2',
          'cpu-features',
          // Don't externalize TypeScript files - they should be bundled
          // Only externalize Node.js built-in modules
        ],
      },
    },

    ssr: {
      // Don't use noExternal: true as it can interfere with SvelteKit's virtual modules
      // Instead, externalize only Node.js built-ins and native modules
      external: [
        'fs',
        'path',
        'os',
        'crypto',
        'stream',
        'util',
        'events',
        'child_process',
        'node-pty',
        'ssh2',
        'cpu-features',
      ],
    },

    server: {
      // Support running multiple dev servers concurrently via DEV_PORT env var
      // strictPort: true ensures we fail fast if port is taken, rather than silently using another port
      // which causes Electron to connect to the wrong server
      //
      // Default 5190 is deliberately outside the MCP bridge scan range (5179–5188) so
      // the Vite dev server never collides with the HTTP MCP bridge or the reference
      // Intent app's WSS API server (which listens on 5180).
      port: parseInt(process.env.DEV_PORT || '5190', 10),
      strictPort: true,
      // Use explicit IPv4 address to avoid issues on Linux where 'localhost' may
      // resolve to ::1 (IPv6 only), causing wait-on and Electron to fail to connect.
      host: '127.0.0.1',

      cors: true,

      // Pre-transform the primary SvelteKit entry paths before announcing sandbox readiness.
      // This avoids sending the first tunneled browser through a cold transform waterfall.
      ...(isWebBuild
        ? {
            warmup: {
              clientFiles: [
                'src/routes/+layout.svelte',
                'src/routes/[(]app[)]/+page.svelte',
                'src/routes/sandbox/[[]slug]/+page.svelte',
              ],
            },
          }
        : {}),

      // Electron connects directly to this host. Web clients derive HMR host
      // and port from the page URL so a daemon-side tunnel also carries HMR.
      ...(isWebBuild
        ? {}
        : {
            hmr: {
              protocol: 'ws',
              host: '127.0.0.1',
            },
          }),

      fs: {
        allow: ['..'],
        strict: false,
      },

      watch: {
        // Use native file watching when available (faster than polling)
        // Only use polling as fallback
        usePolling: false,
        // Ignore non-source directories and workspace data files
        // NOTE: Be careful with ignore patterns - they can accidentally match the project directory
        ignored: [
          '**/node_modules/**',
          '**/dist/**',
          '**/dist-electron/**',
          '**/.git/**',
          '**/.worktrees/**',
          // Ignore nested isolated worktrees under .intent/ — their SvelteKit processes
          // rewrite .svelte-kit/tsconfig.json, which triggers tsconfig cache clears and
          // full reloads of the root dev server, stalling the app (monorepo#3150)
          '**/.intent/**',
          // Ignore iOS/Xcode project files to prevent Electron app reloads during Xcode builds
          '**/ios/**',
          '**/.augment/**',
          '**/playwright-report/**',
          '**/test-results/**',
          // Tests are not part of the running renderer module graph. Vite falls back to
          // a full page reload when they change, which destroys in-progress app state
          // even when the corresponding runtime component updates cleanly through HMR.
          '**/*.test.*',
          '**/*.spec.*',
          '**/__tests__/**',
          '**/__mocks__/**',
          '**/tests/**',
          '**/test/**',
          // Ignore the .workspace/ data subdirectories where runtime data is stored
          // This prevents HMR reloads when agents modify workspace data files
          // Note: We do NOT ignore the entire ~/.workspaces/ directory because
          // git worktrees for development may be located there
          '**/.workspace/**',
          // Ignore preload directory - it's Electron-specific and compiled separately
          // Changes here should not trigger HMR (the generate:ipc-channels script writes here)
          '**/src/preload/**',
          // Ignore .svelte-kit/generated files to prevent page reloads when SvelteKit regenerates routes
          // This is critical because SvelteKit periodically regenerates these files and the page reload
          // can break the router, causing blank pages and "Not found" errors
          '**/.svelte-kit/generated/**',
          '**/.svelte-kit/types/**',
          // Ignore non-source files that external processes may modify (test runners, package managers, etc.)
          // Changes to these files trigger full page reloads (not HMR-updateable), which destroys
          // in-flight state like workspace creation navigation and causes the app to reload at "/"
          '**/package.json',
          '**/pnpm-lock.yaml',
          '**/package-lock.json',
          '**/test-reports/**',
          '**/log.txt',
        ],
      },
    },

    resolve: {
      alias: [
        // Path aliases for cleaner imports
        { find: '$lib', replacement: join(__dirname, './src/lib') },
        { find: '$store', replacement: join(__dirname, './src/store') },
        { find: '$features', replacement: join(__dirname, './src/features') },
        { find: '$shared', replacement: join(__dirname, './src/shared') },

        // Low-churn compatibility aliases: existing icon identifiers now resolve
        // to the Phosphor-backed catalog and renderer.
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: join(__dirname, './src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: join(__dirname, './src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.svelte'],
      conditions: ['import', 'module', 'browser', 'default'],
    },

    define: {
      'process.env.IS_ELECTRON': JSON.stringify(!isWebBuild),
      // Renderer-visible build profile: a web build never receives a preload
      // bridge, even when it is loaded inside the app's own <webview>.
      'process.env.INTENT_BUILD_TARGET': JSON.stringify(isWebBuild ? 'web' : 'electron'),
      // Never compile production web credentials into versioned static JS.
      // /runtime-config.js is loaded before the application bootstrap instead.
      'process.env.VITE_INTENTD_WS_URL': JSON.stringify(isProductionWebBuild ? '' : browserWsUrl),
      ...webDefines,
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __DEV_GIT_BRANCH__: JSON.stringify(
        process.env.NODE_ENV === 'development'
          ? (() => {
              try {
                return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
              } catch {
                return '';
              }
            })()
          : '',
      ),
    },

    optimizeDeps: {
      // Allow Vite to auto-discover dependencies for optimal HMR performance
      // noDiscovery: true was causing some deps to not be pre-bundled
      exclude: [
        // Node.js built-ins
        'fs',
        'path',
        'os',
        'crypto',
        'stream',
        'util',
        'events',
        'child_process',
        'electron',
        // Native modules (cannot be bundled by esbuild)
        'node-pty',
        'ssh2',
        'cpu-features',
        // Svelte internals (but NOT @sveltejs/kit - it needs to be pre-bundled for virtual modules to work)
        'svelte',
        'svelte/internal',
        'svelte/internal/client',
        // Node.js only packages
        'ajv',
        'conf',
        'ajv-keywords',
        'tippy.js',
        'isomorphic-dompurify',
        'jsdom',
        // Large editor packages (handled separately)
        'monaco-editor',
        'monaco-editor/editor/editor.worker',
        'monaco-editor/language/json/json.worker',
        'monaco-editor/language/css/css.worker',
        'monaco-editor/language/html/html.worker',
        'monaco-editor/language/typescript/ts.worker',
        // TipTap and ProseMirror (complex dependency graphs)
        '@tiptap/core',
        '@tiptap/starter-kit',
        '@tiptap/pm',
        'prosemirror-state',
        'prosemirror-view',
        'prosemirror-model',
      ],
      include: [
        // Essential utilities
        'uuid',
        'highlight.js',
        'highlight.js/lib/core',
        'lowlight',
        'date-fns',
        'canvas-confetti',
        // Terminal emulator
        '@xterm/xterm',
        '@xterm/addon-fit',
        '@xterm/addon-search',
        '@xterm/addon-web-links',
        '@xterm/addon-webgl',
        // Diff viewer
        '@pierre/diffs',
        // D3 visualization
        'd3',
        // Mermaid diagram rendering (dynamically imported, must be pre-bundled to avoid reload)
        'mermaid',
        // TipTap extensions (not core, but specific extensions used lazily)
        '@tiptap/extension-code',
        'svelte-tiptap',
      ],
    },
  };
});
