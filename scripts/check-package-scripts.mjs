import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// package.json scripts must not nest a bare `pnpm` command. A nested `pnpm run x`,
// `pnpm exec tsc`, or `pnpm tsc` resolves `pnpm` via PATH, so a global pnpm that differs
// from the `packageManager` pin aborts the chain under corepack (cloudlands-fe#2350,
// #2368, #2380). Chains re-enter the invoking pnpm through `scripts/pnpm-run.mjs`;
// binaries run bare, since pnpm puts `node_modules/.bin` on PATH for every script.
export const PACKAGE_JSON_PATH = 'package.json';
export const RUN_WRAPPER = 'node scripts/pnpm-run.mjs';

// Documented exceptions: script name → reason. Keep empty unless a script genuinely
// cannot go through `scripts/pnpm-run.mjs`.
export const ALLOWLIST = Object.freeze({});

// A bare token is `pnpm` at the start of the value or after whitespace / a shell operator
// / an opening parenthesis / a quote, followed by whitespace or the end of the value.
// `scripts/pnpm-run.mjs` and `pnpm-launcher.mjs` do not match: the former is preceded by
// `/`, and both are followed by `-`.
const BARE_PNPM_PATTERN = /(?<=^|[\s;&|(`'"])pnpm(?=\s|$)/g;
// The offending fragment runs from the token to the next shell operator or quote.
const FRAGMENT_END = /[;&|)`'"]/;

function suggestFix(fragment) {
  const [, subcommand, ...rest] = fragment.split(/\s+/);
  if (subcommand === undefined) return `use \`${RUN_WRAPPER} <script>\``;
  if (subcommand === 'run') {
    const target = rest[0] ?? '<script>';
    return `use \`${RUN_WRAPPER} ${target}\``;
  }
  if (subcommand === 'exec') {
    const binary = rest[0] ?? '<bin>';
    return `run \`${binary}\` directly (node_modules/.bin is on PATH)`;
  }
  if (subcommand === 'dlx') {
    return 'route the invocation through `scripts/pnpm-launcher.mjs` in a Node script';
  }
  return `run \`${subcommand}\` directly if it is a node_modules/.bin binary, or use \`${RUN_WRAPPER} <script>\` for a package script`;
}

export function findBarePnpmViolations(scripts, allowlist = ALLOWLIST) {
  const violations = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string' || name in allowlist) continue;
    for (const match of value.matchAll(BARE_PNPM_PATTERN)) {
      const tail = value.slice(match.index);
      const end = tail.search(FRAGMENT_END);
      const fragment = (end === -1 ? tail : tail.slice(0, end)).trim();
      violations.push({ script: name, fragment, fix: suggestFix(fragment) });
    }
  }
  return violations;
}

export function findStaleAllowlistEntries(scripts, allowlist = ALLOWLIST) {
  return Object.keys(allowlist).filter(
    (name) =>
      !(name in scripts) || findBarePnpmViolations({ [name]: scripts[name] }, {}).length === 0,
  );
}

export function formatViolation({ script, fragment, fix }) {
  return `${PACKAGE_JSON_PATH} scripts.${script}: bare \`${fragment}\` → ${fix}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { scripts = {} } = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const violations = findBarePnpmViolations(scripts);
  const stale = findStaleAllowlistEntries(scripts);
  if (violations.length || stale.length) {
    const lines = [];
    if (violations.length) {
      lines.push(
        'Bare `pnpm` commands nested in package.json scripts (they resolve pnpm via PATH and break under a mismatched global pnpm):',
        ...violations.map(formatViolation),
      );
    }
    if (stale.length) {
      lines.push(
        `Stale ALLOWLIST entries in scripts/check-package-scripts.mjs (script missing or no longer nests pnpm): ${stale.join(', ')}`,
      );
    }
    console.error(lines.join('\n'));
    process.exit(1);
  }
  console.log(
    `Package scripts valid: ${Object.keys(scripts).length} scripts nest no bare pnpm command.`,
  );
}
