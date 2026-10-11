import { readFileSync } from 'node:fs';
import { stripJsonc } from './check-dead-code-lib.mjs';
import { svelteImports } from './knip-svelte.mjs';

// Keep entries, rules and exclusions in the existing config. The gate selects this
// dynamic config because Knip's supported compiler overrides must be functions.
const config = JSON.parse(stripJsonc(readFileSync('knip.jsonc', 'utf8')));
export default {
  ...config,
  // Explicit child workspaces require an explicit root; preserve every legacy entry.
  workspaces: {
    '.': {
      entry: config.entry,
      project: config.project,
      paths: config.paths,
      ignore: config.ignore,
    },
    ...config.workspaces,
  },
  compilers: { svelte: svelteImports },
};
