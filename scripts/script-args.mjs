/**
 * CLI arguments without the `--` that pnpm 10 forwards from
 * `pnpm run <script> -- --flag`. Drops the first `--` wherever it is, as npm
 * does: package.json flags (`observe-memory.js --follow`) come before it. A
 * later `--` stays, so scripts that forward args after their own `--` still can.
 * Use it in every script that rejects unknown arguments;
 * `script-args.test.ts` enforces this.
 *
 * @param {readonly string[]} [args] defaults to `process.argv.slice(2)`
 * @returns {string[]}
 */
export function scriptArgs(args = process.argv.slice(2)) {
  const separator = args.indexOf('--');
  return separator === -1 ? [...args] : [...args.slice(0, separator), ...args.slice(separator + 1)];
}
