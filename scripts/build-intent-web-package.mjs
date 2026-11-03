#!/usr/bin/env node
// Assembles the publishable @intent-hq/web package in dist/intent-web-package:
//   bin/intent-web.mjs  the CLI and server, bundled (only `ws` stays external)
//   web/                the prebuilt web UI (`pnpm run build:web` output)
//   package.json, README.md, LICENSE, NOTICE
// Run `pnpm run build:web` first. The package version is the cloudlands-fe
// version, so every release publishes the matching @intent-hq/web.
// Verified by scripts/smoke-intent-web-package.mjs and published by
// .github/workflows/publish-intent-web.yml.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PACKAGE_NAME = '@intent-hq/web';
export const BIN_NAME = 'intent-web';
export const ENTRY = 'src/features/intent-web/main/intent-web-bin.ts';
// Runtime dependencies left outside the bundle. Everything else is inlined.
export const RUNTIME_DEPENDENCIES = ['ws'];

export function readPinnedTailcatVersion(root = ROOT) {
  const source = fs.readFileSync(path.join(root, 'scripts/fetch-tailcat.cjs'), 'utf8');
  const version = source.match(/const TAILCAT_VERSION = '([^']+)'/)?.[1];
  if (!version)
    throw new Error('Cannot read pinned tailcat version from scripts/fetch-tailcat.cjs');
  return version;
}

// The published manifest, derived from the app's package.json so the version,
// license, engines and `ws` range never drift from the desktop build.
export function packageManifest(app) {
  const dependencies = {};
  for (const name of RUNTIME_DEPENDENCIES) {
    const range = app.dependencies?.[name];
    if (!range) throw new Error(`package.json has no dependency on ${name}`);
    dependencies[name] = range;
  }
  if (!app.engines?.node) throw new Error('package.json has no engines.node');
  return {
    name: PACKAGE_NAME,
    version: app.version,
    description: 'Intent in the browser: a standalone web server for Intent machines.',
    license: app.license,
    type: 'module',
    bin: { [BIN_NAME]: 'bin/intent-web.mjs' },
    files: ['bin', 'web', 'README.md', 'LICENSE', 'NOTICE'],
    engines: { node: app.engines.node },
    dependencies,
    repository: {
      type: 'git',
      url: 'git+https://github.com/intent-hq/cloudlands-fe.git',
    },
    homepage: 'https://github.com/intent-hq/cloudlands-fe#readme',
    keywords: ['intent', 'intentd', 'web'],
    publishConfig: { access: 'public' },
  };
}

// Generated (git-ignored) modules the bundle may read. Paraglide's output is
// produced by `pnpm run build:web`, which always runs first.
const ALLOWED_GENERATED = ['src/shared/paraglide/'];
// The desktop build config (src/main/build-config.generated.ts, written by
// scripts/generate-build-config.cjs) is reached through
// backend-connection.ts → src/main/isolated-test-profile.ts. The package is
// never an isolated test build, so it gets fixed values instead of whatever a
// local .env or environment would bake in.
const BUILD_CONFIG_ID = '\0intent-web:build-config';
const buildConfigStub = {
  name: 'intent-web-build-config',
  enforce: 'pre',
  resolveId(source) {
    return /(^|\/)build-config\.generated(\.js|\.ts)?$/.test(source) ? BUILD_CONFIG_ID : null;
  },
  load(id) {
    if (id !== BUILD_CONFIG_ID) return null;
    return `export const BUILD_CONFIG = ${JSON.stringify({
      GIT_COMMIT_HASH: '',
      ISOLATED_TEST_BUILD_ID: '',
      ISOLATED_TEST_BACKEND_SHA: '',
    })};`;
  },
};

// Bundled source files that git ignores, other than ALLOWED_GENERATED: such a
// file exists only where some other build step happened to run, so the
// package would build locally but not on a clean checkout.
export function generatedInputs(root, files) {
  const relative = files
    .filter((file) => path.isAbsolute(file) && !file.includes('/node_modules/'))
    .map((file) => path.relative(root, file))
    .filter((file) => !file.startsWith('..'));
  if (relative.length === 0) return [];
  const result = spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: root,
    input: relative.join('\n'),
    encoding: 'utf8',
  });
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`git check-ignore failed: ${result.stderr}`);
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .filter((file) => !ALLOWED_GENERATED.some((prefix) => file.startsWith(prefix)));
}

export async function bundle({ root, outFile, tailcatVersion }) {
  const { build } = await import('vite');
  const external = new RegExp(`^(node:|(${RUNTIME_DEPENDENCIES.join('|')})(/|$))`);
  const inputs = [];
  const collectInputs = {
    name: 'intent-web-collect-inputs',
    buildEnd() {
      inputs.push(...this.getModuleIds());
    },
  };
  await build({
    configFile: false,
    root,
    logLevel: 'warn',
    // Vite's own .env loading and public dir copy do not apply to a server bundle.
    envDir: false,
    publicDir: false,
    resolve: {
      alias: {
        $lib: path.join(root, 'src/lib'),
        $store: path.join(root, 'src/store'),
        $shared: path.join(root, 'src/shared'),
        $features: path.join(root, 'src/features'),
      },
    },
    define: {
      __INTENT_WEB_TAILCAT_VERSION__: JSON.stringify(tailcatVersion),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    plugins: [buildConfigStub, collectInputs],
    ssr: { noExternal: true, external: RUNTIME_DEPENDENCIES, target: 'node' },
    build: {
      ssr: path.join(root, ENTRY),
      outDir: path.dirname(outFile),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      target: 'node22',
      reportCompressedSize: false,
      rollupOptions: {
        external: (id) => external.test(id),
        output: {
          format: 'es',
          entryFileNames: path.basename(outFile),
          inlineDynamicImports: true,
          banner: '#!/usr/bin/env node',
        },
      },
    },
  });
  fs.chmodSync(outFile, 0o755);
  const generated = generatedInputs(root, inputs);
  if (generated.length)
    throw new Error(
      `The intent-web bundle reads generated files a clean checkout lacks:\n  ${generated.join('\n  ')}`,
    );
  return { inputs };
}

export async function buildIntentWebPackage({
  root = ROOT,
  outDir = path.join(root, 'dist/intent-web-package'),
  webDir = path.join(root, 'dist/web'),
} = {}) {
  if (!fs.existsSync(path.join(webDir, 'index.html')))
    throw new Error(`${webDir}/index.html is missing; run pnpm run build:web first.`);
  const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = packageManifest(app);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await bundle({
    root,
    outFile: path.join(outDir, 'bin/intent-web.mjs'),
    tailcatVersion: readPinnedTailcatVersion(root),
  });
  // Sourcemaps are not shipped: they double the size and the web build is
  // already built without them for production.
  fs.cpSync(webDir, path.join(outDir, 'web'), {
    recursive: true,
    filter: (source) => !source.endsWith('.map'),
  });
  fs.copyFileSync(
    path.join(root, 'src/features/intent-web/package/README.md'),
    path.join(outDir, 'README.md'),
  );
  for (const file of ['LICENSE', 'NOTICE'])
    fs.copyFileSync(path.join(root, file), path.join(outDir, file));
  fs.writeFileSync(path.join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { outDir, manifest };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { outDir, manifest } = await buildIntentWebPackage();
  console.log(`Built ${manifest.name}@${manifest.version} in ${path.relative(ROOT, outDir)}`);
}
