/**
 * CLI arguments without the leading `--` that pnpm 10 forwards from
 * `pnpm run <script> -- --flag`. Use it in every script that rejects unknown
 * arguments; `script-args.test.ts` enforces this.
 *
 * @param {readonly string[]} [args] defaults to `process.argv.slice(2)`
 * @returns {string[]}
 */
export function scriptArgs(args = process.argv.slice(2)) {
  return args[0] === '--' ? args.slice(1) : [...args];
}
