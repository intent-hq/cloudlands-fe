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
  const playwrightEntry = ctCoreRequire.resolve('playwright');

  // Locate the playwright package dir (its package.json subpath is not
  // exported either) and its CLI entry point.
  let packageDir = path.dirname(playwrightEntry);
  while (!existsSync(path.join(packageDir, 'package.json'))) {
    const parent = path.dirname(packageDir);
    if (parent === packageDir) {
      throw new Error(`could not locate playwright package.json above ${playwrightEntry}`);
    }
    packageDir = parent;
  }
  const cliPath = path.join(packageDir, 'cli.js');
  if (!existsSync(cliPath)) {
    throw new Error(`playwright CLI not found at ${cliPath}`);
  }
  const { version } = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  return { cliPath, version };
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
const args = ['test', '-c', 'playwright-ct.config.ts', ...forwarded];
console.error(`[run-ct-tests] using playwright@${cli.version} (${cli.cliPath})`);

const child = spawn(process.execPath, [cli.cliPath, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
