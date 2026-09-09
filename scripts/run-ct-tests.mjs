#!/usr/bin/env node
/**
 * Launcher for Playwright component tests (playwright-ct.config.ts).
 *
 * The @playwright/experimental-ct-* packages stopped at 1.58.x while the
 * repo's top-level playwright / @playwright/test are newer. Running the CT
 * config with the top-level `playwright` CLI drives ct-core's babel
 * transform with an AST from a different babel instance and crashes before
 * test discovery ("Couldn't find a Program" / "getBlockParent" in
 * tsxTransform.js). See intent-hq/monorepo#1586.
 *
 * This launcher resolves the `playwright` CLI from
 * @playwright/experimental-ct-core's own dependency tree so the runner
 * version always matches the CT transform version, then forwards all CLI
 * args to `playwright test -c playwright-ct.config.ts`.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveCtAlignedPlaywrightCli() {
  // Walk the dependency tree: repo root -> ct-svelte -> ct-core -> playwright.
  // Each hop uses createRequire from the previous package's own location, so
  // pnpm's nested resolutions are honored without hardcoding .pnpm paths.
  const rootRequire = createRequire(path.join(repoRoot, 'package.json'));
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

let cli;
try {
  cli = resolveCtAlignedPlaywrightCli();
} catch (error) {
  console.error(
    '[run-ct-tests] Failed to resolve the playwright CLI from ' +
      "@playwright/experimental-ct-core's dependency tree. Did `pnpm install` run?\n" +
      `[run-ct-tests] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}

// pnpm forwards a literal `--` separator (`pnpm run test:ct -- --list`); drop it.
const forwarded = process.argv.slice(2);
if (forwarded[0] === '--') forwarded.shift();

// CI helpers: browsers must match the CT-aligned runner version (not the
// repo's top-level playwright), so version printing (for cache keys) and
// browser installation go through this launcher too.
let args;
if (forwarded[0] === '--print-playwright-version') {
  process.stdout.write(`${cli.version}\n`);
  process.exit(0);
} else if (forwarded[0] === '--install-browsers') {
  args = ['install', ...forwarded.slice(1)];
} else {
  args = ['test', '-c', 'playwright-ct.config.ts', ...forwarded];
}
console.error(`[run-ct-tests] using playwright@${cli.version} (${cli.cliPath})`);

// Playwright's default transform cache is host-wide. Persistent CI runners
// can reuse incomplete component metadata from another checkout, which leaves
// valid Svelte hosts out of the generated component registry. Keep the cache
// project-local while preserving an explicit override.
const transformCacheDir =
  process.env.PWTEST_CACHE_DIR?.trim() ||
  path.join(repoRoot, 'node_modules', '.cache', 'playwright-transform');

const child = spawn(process.execPath, [cli.cliPath, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, PWTEST_CACHE_DIR: transformCacheDir },
});
child.on('error', (error) => {
  console.error(`[run-ct-tests] failed to spawn playwright: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    const signalNumber = os.constants.signals[signal];
    process.exit(signalNumber ? 128 + signalNumber : 1);
  }
  process.exit(code ?? 1);
});
