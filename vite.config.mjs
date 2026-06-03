import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { sentryVitePlugin } from '@sentry/vite-plugin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json for Sentry release
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
const sentryRelease = `intent@${packageJson.version}`;

// Node modules that should be excluded from browser bundle
// These are dependencies of electron-store that use Node.js APIs
const nodeOnlyModules = [
  'electron-store',
  'conf',
  'atomically',
  'stubborn-fs',
  'stubborn-utils',
  'chokidar',
];

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
    // Block HMR for .svelte-kit/generated and .svelte-kit/types files
    if (file.includes('.svelte-kit/generated') || file.includes('.svelte-kit/types')) {
      console.log(`[HMR-BLOCKED] Prevented page reload for: ${file.split('.svelte-kit/')[1]}`);
      // Return empty array to prevent HMR from processing this file
      return [];
    }
    // Block HMR for non-source files that can't be hot-updated and would trigger
    // a full page reload, destroying in-flight state (e.g. workspace creation navigation).
    // This is a safety net in case the server.watch.ignored patterns don't catch everything.
    const basename = file.split('/').pop() || '';
    if (
      basename === 'package.json' ||
      basename === 'pnpm-lock.yaml' ||
      basename === 'package-lock.json' ||
      basename === 'log.txt' ||
      file.includes('/test-reports/')
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
      console.warn(`[handle-unhandled-sveltekit-modules] Providing fallback for unhandled module: __sveltekit/${moduleName}`);

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

// Custom plugin to exclude Node.js-only files from browser bundle
const excludeNodeModules = () => ({
  name: 'exclude-node-modules',
  // Run before other plugins to ensure we don't interfere with virtual modules
  enforce: 'pre',
  resolveId(source, _importer, options) {
    // Never intercept virtual modules (they start with \0 or virtual:)
    // This MUST be checked first, before any other logic
    if (source.startsWith('\0') || source.startsWith('virtual:') || source.includes('__sveltekit')) {
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

// Build Sentry plugin for source map uploads (production builds only)
const sentryPlugin = process.env.SENTRY_AUTH_TOKEN
  ? sentryVitePlugin({
    org: 'sutterhill',
    project: 'augment-intent',
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: {
      name: sentryRelease,
    },
    sourcemaps: {
      // Upload all source maps from the build output
      filesToDeleteAfterUpload: ['./dist/**/*.map'],
    },
    debug: true,
  })
  : null;

export default defineConfig({
  // Plugin order:
  // 1. preventSvelteKitRegenHMR() - blocks HMR page reloads for .svelte-kit/generated files
  // 2. sveltekit() - SvelteKit's virtual modules and SSR handling
  // 3. handleUnhandledSvelteKitModules() - catches any __sveltekit/* modules not handled by SvelteKit
  // 4. excludeNodeModules() - excludes Node.js-only code from browser bundle
  // 5. sentryPlugin - uploads source maps to Sentry (production only, when SENTRY_AUTH_TOKEN is set)
  plugins: [
    preventSvelteKitRegenHMR(),
    sveltekit(),
    handleUnhandledSvelteKitModules(),
    excludeNodeModules(),
    sentryPlugin,
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
    // Generate sourcemaps: 'hidden' in production (for Sentry upload, not exposed publicly),
    // true in development for debugging
    sourcemap: process.env.NODE_ENV === 'development' ? true : 'hidden',
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
        'chokidar',
        // Don't externalize TypeScript files - they should be bundled
        // Only externalize Node.js built-in modules
      ],
    },
  },

  ssr: {
    // Don't use noExternal: true as it can interfere with SvelteKit's virtual modules
    // Instead, externalize only Node.js built-ins and native modules
    external: [
      'fs', 'path', 'os', 'crypto', 'stream', 'util', 'events', 'child_process',
      'node-pty', 'ssh2', 'cpu-features', 'chokidar',
    ],
  },

  server: {
    // Support running multiple dev servers concurrently via DEV_PORT env var
    // strictPort: true ensures we fail fast if port is taken, rather than silently using another port
    // which causes Electron to connect to the wrong server
    port: parseInt(process.env.DEV_PORT || '5177', 10),
    strictPort: true,
    // Use explicit IPv4 address to avoid issues on Linux where 'localhost' may
    // resolve to ::1 (IPv6 only), causing wait-on and Electron to fail to connect.
    host: '127.0.0.1',

    cors: true,

    // Configure HMR for Electron (will use the same port as the server)
    hmr: {
      protocol: 'ws',
      host: '127.0.0.1',
      // HMR port will auto-match server port when not specified
    },

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
        '**/.augment/**',
        '**/playwright-report/**',
        '**/test-results/**',
        // Ignore the .workspace/ data subdirectories where runtime data is stored
        // This prevents HMR reloads when agents modify workspace data files
        // Note: We do NOT ignore the entire ~/.workspaces/ directory because
        // git worktrees for development may be located there
        '**/.workspace/**',
        // Ignore agent instruction files to prevent HMR when editing via sandbox/rules page
        '**/features/agent/instructions/**',
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
      { find: '$app', replacement: join(__dirname, './src/app') },
      { find: '$features', replacement: join(__dirname, './src/features') },
      { find: '$shared', replacement: join(__dirname, './src/shared') },

      // Browser-safe config (uses hardcoded values instead of process.env)
      {
        find: /^.*\/shared\/config$/,
        replacement: join(__dirname, './src/shared/config-browser.ts'),
      },
      {
        find: /^.*\/shared\/config\.ts$/,
        replacement: join(__dirname, './src/shared/config-browser.ts'),
      },

      // Icon library wrapper for Svelte 5 compatibility
      {
        find: /^svelte-fa$/,
        replacement: join(__dirname, './src/lib/components/shared/icons/fa-proxy.ts'),
      },
      {
        find: /^svelte-fa-original$/,
        replacement: join(__dirname, './node_modules/svelte-fa/dist/index.js'),
      },
    ],
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.svelte'],
    conditions: ['import', 'module', 'browser', 'default'],
  },

  define: {
    'process.env.IS_ELECTRON': JSON.stringify(true),
    '__DEV_GIT_BRANCH__': JSON.stringify(
      process.env.NODE_ENV === 'development'
        ? (() => { try { return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim(); } catch { return ''; } })()
        : ''
    ),
  },

  optimizeDeps: {
    // Allow Vite to auto-discover dependencies for optimal HMR performance
    // noDiscovery: true was causing some deps to not be pre-bundled
    exclude: [
      // Node.js built-ins
      'fs', 'path', 'os', 'crypto', 'stream', 'util', 'events', 'child_process', 'electron',
      // Native modules (cannot be bundled by esbuild)
      'node-pty', 'ssh2', 'cpu-features', 'chokidar',
      // Svelte internals (but NOT @sveltejs/kit - it needs to be pre-bundled for virtual modules to work)
      'svelte', 'svelte/internal', 'svelte/internal/client',
      // Node.js only packages
      'ajv', 'conf', 'ajv-keywords', 'tippy.js', 'isomorphic-dompurify', 'jsdom',
      // Large editor packages (handled separately)
      'monaco-editor', 'monaco-editor/esm/vs/editor/editor.worker',
      'monaco-editor/esm/vs/language/json/json.worker',
      'monaco-editor/esm/vs/language/css/css.worker',
      'monaco-editor/esm/vs/language/html/html.worker',
      'monaco-editor/esm/vs/language/typescript/ts.worker',
      // TipTap and ProseMirror (complex dependency graphs)
      '@tiptap/core', '@tiptap/starter-kit', '@tiptap/pm',
      'prosemirror-state', 'prosemirror-view', 'prosemirror-model',
    ],
    include: [
      // Essential utilities
      'uuid', 'highlight.js', 'highlight.js/lib/core', 'lowlight',
      'date-fns', 'canvas-confetti',
      // Terminal emulator
      '@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-search',
      '@xterm/addon-web-links', '@xterm/addon-webgl',
      // Diff viewer
      '@pierre/diffs',
      // D3 visualization
      'd3', 'd3-delaunay',
      // Mermaid diagram rendering (dynamically imported, must be pre-bundled to avoid reload)
      'mermaid',
      // FontAwesome icons
      '@fortawesome/free-regular-svg-icons',
      // TipTap extensions (not core, but specific extensions used lazily)
      '@tiptap/extension-code', 'svelte-tiptap',
    ],
  },
});
