import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// The reviewed browser experiment; package/lockfile pins are checked against this.
// The supplier installs browsers only. It must never become the CT test runner.
export const CT_BROWSER = Object.freeze({
  runnerVersion: '1.58.2',
  supplierVersion: '1.63.0',
  chromiumVersion: '153.0.8010.12',
  revision: '1243',
});

export function resolveCtAlignedPlaywrightCli() {
  // Walk the dependency tree: repo root -> ct-svelte -> ct-core -> playwright.
  // Each hop uses createRequire from the previous package's own location, so
  // pnpm's nested resolutions are honored without hardcoding .pnpm paths.
  const rootRequire = createRequire(path.join(root, 'package.json'));
  const ctSveltePkgJson = rootRequire.resolve('@playwright/experimental-ct-svelte/package.json');
  const ctSvelteRequire = createRequire(ctSveltePkgJson);
  // ct-core's package.json is not an exported subpath; resolve its main entry
  // and require from there instead.
  const ctCoreEntry = ctSvelteRequire.resolve('@playwright/experimental-ct-core');
  const ctCoreRequire = createRequire(ctCoreEntry);
  // Unlike ct-core, playwright does export its ./package.json subpath.
  const playwrightPkgJsonPath = ctCoreRequire.resolve('playwright/package.json');
  const packageDir = path.dirname(playwrightPkgJsonPath);

  const pkg = JSON.parse(readFileSync(playwrightPkgJsonPath, 'utf8'));
  const compiler = JSON.parse(readFileSync(ctSveltePkgJson, 'utf8'));
  const core = JSON.parse(
    readFileSync(path.join(path.dirname(ctCoreEntry), 'package.json'), 'utf8'),
  );
  const driver = ctCoreRequire('playwright-core/package.json');
  if (
    [compiler.version, core.version, pkg.version, driver.version].some(
      (version) => version !== CT_BROWSER.runnerVersion,
    )
  ) {
    throw new Error(
      `CT compiler, runner and driver must all be ${CT_BROWSER.runnerVersion}; got ${[compiler.version, core.version, pkg.version, driver.version].join(', ')}. Run pnpm install.`,
    );
  }
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.playwright;
  if (!binRel) {
    throw new Error(`playwright bin entry not found in ${playwrightPkgJsonPath}`);
  }
  const cliPath = path.join(packageDir, binRel);
  if (!existsSync(cliPath)) {
    throw new Error(`playwright CLI not found at ${cliPath}`);
  }
  return { cliPath, version: pkg.version };
}

/** @param {{ version?: string }} pkg
 * @param {{ name: string, revision?: string, browserVersion?: string }[]} browsers */
export function assertCtSupplier(pkg, browsers) {
  if (pkg.version !== CT_BROWSER.supplierVersion) {
    throw new Error(
      `Wrong CT browser supplier: expected ${CT_BROWSER.supplierVersion}, got ${pkg.version}. Run pnpm install.`,
    );
  }
  for (const name of ['chromium', 'chromium-headless-shell']) {
    const browser = browsers.find((entry) => entry.name === name);
    if (
      browser?.revision !== CT_BROWSER.revision ||
      browser?.browserVersion !== CT_BROWSER.chromiumVersion
    ) {
      throw new Error(
        `Wrong CT ${name} build in supplier: expected ${CT_BROWSER.chromiumVersion} revision ${CT_BROWSER.revision}. Run pnpm install.`,
      );
    }
  }
}

export function resolveCtBrowser({ headless = true, requireInstalled = true } = {}) {
  const supplierDir = path.dirname(require.resolve('ct-browser/package.json'));
  const pkg = JSON.parse(readFileSync(path.join(supplierDir, 'package.json'), 'utf8'));
  const { browsers } = JSON.parse(readFileSync(path.join(supplierDir, 'browsers.json'), 'utf8'));
  assertCtSupplier(pkg, browsers);
  // Use the pinned supplier's registry, including OS/architecture, relative paths,
  // PLAYWRIGHT_BROWSERS_PATH=0, and per-runner caches. Never guess a .pnpm/bin path.
  const loadSupplier = createRequire(path.join(supplierDir, 'package.json'));
  const { registry, registryDirectory } = loadSupplier('ct-browser/lib/coreBundle').registry;
  const executable = registry.findExecutable(headless ? 'chromium-headless-shell' : 'chromium');
  const executablePath = executable.executablePath();
  if (!executablePath || (requireInstalled && !existsSync(executablePath))) {
    throw new Error(
      `Missing CT browser ${CT_BROWSER.chromiumVersion} at ${executablePath}. Run node scripts/run-ct-tests.mjs --install-browsers chromium with the same PLAYWRIGHT_BROWSERS_PATH.`,
    );
  }
  if (executable.browserVersion !== CT_BROWSER.chromiumVersion) {
    throw new Error(`Wrong CT browser registry version: ${executable.browserVersion}`);
  }
  const cacheKey = `ct-${CT_BROWSER.runnerVersion}-pw-${CT_BROWSER.supplierVersion}-chromium-${CT_BROWSER.chromiumVersion}-r${CT_BROWSER.revision}`;
  const cliPath = path.join(supplierDir, 'cli.js');
  return {
    identity: CT_BROWSER,
    executablePath,
    cacheDir: registryDirectory,
    cacheKey,
    readinessMarker: path.join(registryDirectory, `.with-deps-${cacheKey}`),
    install: { cliPath, args: ['install', 'chromium'] },
    osDeps: { cliPath, args: ['install-deps', '--dry-run', 'chromium'] },
  };
}

/** @param {{ product: string }} runtime
 * @param {string} expectedVersion */
export function assertCtRuntime(runtime, expectedVersion = CT_BROWSER.chromiumVersion) {
  if (
    !['Chrome', 'HeadlessChrome'].some((name) => runtime.product === `${name}/${expectedVersion}`)
  ) {
    throw new Error(
      `Wrong CT browser runtime: expected Chromium ${expectedVersion}, got ${runtime.product}. No browser fallback is allowed.`,
    );
  }
}

/** @param {string} executablePath */
export function ctSourceIdentity(executablePath) {
  /** @param {string} file */
  const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  /** @param {...string} args */
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  return {
    head: git('rev-parse', 'HEAD'),
    status: git('status', '--porcelain'),
    executablePath,
    executableSha256: hash(executablePath),
    files: Object.fromEntries(
      [
        'package.json',
        'pnpm-lock.yaml',
        'scripts/ct-browser.mjs',
        'scripts/run-ct-tests.mjs',
        'playwright-ct.config.ts',
        'playwright/ct-browser-fixtures.ts',
        'src/test/ct-test.ts',
        'patches/playwright-core@1.58.2.patch',
      ].map((file) => [file, hash(path.join(root, file))]),
    ),
  };
}
