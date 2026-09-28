import { readFileSync } from 'node:fs';
import { stripJsonc } from './check-dead-code-lib.mjs';
import { svelteImports } from './knip-svelte.mjs';

// Keep entries, rules and exclusions in the existing config. The gate selects this
// dynamic config because Knip's supported compiler overrides must be functions.
export default {
  ...JSON.parse(stripJsonc(readFileSync('knip.jsonc', 'utf8'))),
  compilers: { svelte: svelteImports },
};
