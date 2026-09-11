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
 *
 * It also owns the HTML-report policy (intent-hq/intent#4652): Playwright's
 * html reporter defaults to `open: 'on-failure'`, which keeps the process
 * alive serving the report on :9323 after a failing run, so chained
 * automation (verify:changed, saved scripts, CI) never sees the exit status.
 * The launcher pins `PLAYWRIGHT_HTML_OPEN=never` unless the caller opts in
 * from an interactive terminal (see `usage()`).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CT_HTML_REPORT_ENV = 'CT_HTML_REPORT';
export const OPEN_REPORT_FLAG = '--open-report';

/** `CT_HTML_REPORT` values → Playwright html reporter `open` modes. */
const CT_HTML_REPORT_MODES = {
  open: 'always',
  always: 'always',
  'on-failure': 'on-failure',
  never: 'never',
};

export function usage() {
  return [
    'Usage: pnpm run test:ct [-- <playwright test args>]',
    '',
    'Runs Playwright component tests with the CT-aligned playwright CLI.',
    'All arguments are forwarded to `playwright test -c playwright-ct.config.ts`.',
    '',
    'Launcher options:',
    `  ${OPEN_REPORT_FLAG}     Serve the HTML report after the run (same as ${CT_HTML_REPORT_ENV}=open).`,
    '  --help, -h        Show this help.',
    '',
    'Environment:',
    `  ${CT_HTML_REPORT_ENV}=open|always|on-failure|never`,
    '                    HTML report viewing policy. Default: never — the run exits with',
    "                    Playwright's status as soon as tests finish; the report is still",
    '                    written to playwright-report/ (view it with `pnpm exec playwright',
    '                    show-report`). Opt-in values only take effect on an interactive',
    '                    terminal; automated (non-TTY) runs never block on the report.',
    '  PLAYWRIGHT_HTML_OPEN',
    `                    When set, respected verbatim (overrides ${CT_HTML_REPORT_ENV}).`,
    '',
    'CI helpers:',
    '  --print-playwright-version   Print the CT-aligned playwright version.',
    '  --install-browsers [...]     Run `playwright install` with the CT-aligned CLI.',
  ].join('\n');
}

/**
 * Split the launcher's own flags from the args forwarded to `playwright test`.
 * pnpm forwards a literal `--` separator (`pnpm run test:ct -- --list`); drop it.
 */
export function parseLauncherArgs(argv) {
  const forwarded = [...argv];
  if (forwarded[0] === '--') forwarded.shift();
  const help = forwarded[0] === '--help' || forwarded[0] === '-h';
  let openReport = false;
  const rest = forwarded.filter((arg) => {
    if (arg === OPEN_REPORT_FLAG) {
      openReport = true;
      return false;
    }
    return true;
  });
  return { forwarded: rest, openReport, help };
}

/**
 * Decide the html reporter `open` mode for this run.
 *
 * Returns `{ open, notice? }` where `open` is the value to export as
 * `PLAYWRIGHT_HTML_OPEN`, or `null` when the caller already set that variable
 * and it must be left untouched. Opt-in (flag or CT_HTML_REPORT) is honored
 * only on an interactive terminal: a non-TTY run (CI, verify:changed, saved
 * scripts) always gets `never`, so the process exits when the tests do.
 */
export function resolveHtmlReportOpen({ env, isTTY, openReport = false }) {
  if (env.PLAYWRIGHT_HTML_OPEN?.trim()) return { open: null };
  const raw = env[CT_HTML_REPORT_ENV]?.trim();
  let requested = openReport ? 'always' : 'never';
  let notice;
  if (raw) {
    const mapped = Object.hasOwn(CT_HTML_REPORT_MODES, raw) ? CT_HTML_REPORT_MODES[raw] : undefined;
    if (mapped) {
      requested = openReport ? 'always' : mapped;
    } else {
      notice =
        `[run-ct-tests] ignoring ${CT_HTML_REPORT_ENV}=${raw}; ` +
        `valid values: ${Object.keys(CT_HTML_REPORT_MODES).join(', ')}`;
    }
  }
  if (requested !== 'never' && !isTTY) {
    return {
      open: 'never',
      notice:
        '[run-ct-tests] stdout is not a TTY; not serving the HTML report ' +
        '(set PLAYWRIGHT_HTML_OPEN explicitly to force it)',
    };
  }
  return notice ? { open: requested, notice } : { open: requested };
}

/** Map a child `exit` event to this process's exit code. */
export function exitCodeFromChild(code, signal) {
  if (signal) {
    const signalNumber = os.constants.signals[signal];
    return signalNumber ? 128 + signalNumber : 1;
  }
  return code ?? 1;
}

/**
 * Spawn the playwright CLI and propagate its exit status through `exit`.
 * `spawnImpl` / `exit` are injectable for tests.
 */
export function runPlaywright({
  cliPath,
  args,
  cwd = repoRoot,
  env = process.env,
  spawnImpl = spawn,
  exit = (code) => process.exit(code),
}) {
  const child = spawnImpl(process.execPath, [cliPath, ...args], { cwd, stdio: 'inherit', env });
  child.on('error', (error) => {
    console.error(`[run-ct-tests] failed to spawn playwright: ${error.message}`);
    exit(1);
  });
  child.on('exit', (code, signal) => exit(exitCodeFromChild(code, signal)));
  return child;
}

export function resolveCtAlignedPlaywrightCli() {
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

/**
 * Build the child environment: project-local transform cache plus the
 * HTML-report policy from `resolveHtmlReportOpen`.
 */
export function buildChildEnv({ env = process.env, isTTY, openReport = false, root = repoRoot }) {
  // Playwright's default transform cache is host-wide. Persistent CI runners
  // can reuse incomplete component metadata from another checkout, which leaves
  // valid Svelte hosts out of the generated component registry. Keep the cache
  // project-local while preserving an explicit override.
  const transformCacheDir =
    env.PWTEST_CACHE_DIR?.trim() ||
    path.join(root, 'node_modules', '.cache', 'playwright-transform');
  const childEnv = { ...env, PWTEST_CACHE_DIR: transformCacheDir };
  const { open, notice } = resolveHtmlReportOpen({ env, isTTY, openReport });
  if (open) childEnv.PLAYWRIGHT_HTML_OPEN = open;
  return { env: childEnv, notice };
}

function main(argv) {
  const { forwarded, openReport, help } = parseLauncherArgs(argv);
  if (help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
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

  const { env, notice } = buildChildEnv({ isTTY: Boolean(process.stdout.isTTY), openReport });
  if (notice) console.error(notice);

  runPlaywright({ cliPath: cli.cliPath, args, env });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main(process.argv.slice(2));
}
