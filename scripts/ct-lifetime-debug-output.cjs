/**
 * Opt-in preload for DEBUG=pw:protocol CT diagnostics. Use with CT_NODE_ARGS:
 * --require=./scripts/ct-lifetime-debug-output.cjs
 *
 * Playwright's native DEBUG_FILE sink keeps large Network response bodies out
 * of test stdout/JSON/HTML (which otherwise hit V8's maximum string length).
 * Each runner/worker gets its own file: a shared DEBUG_FILE is truncated by
 * every new process. This only selects the built-in log sink; no interception.
 */
const { resolve } = require('node:path');

if (!process.env.CT_LIFETIME_OUTPUT) {
  throw new Error('CT_LIFETIME_OUTPUT must name a fresh diagnostic output directory');
}
process.env.DEBUG_FILE = resolve(process.env.CT_LIFETIME_OUTPUT, `protocol-${process.pid}.log`);
