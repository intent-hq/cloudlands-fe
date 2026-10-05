// Every import-source spelling of one `src/<modulePath>` module for a
// `no-restricted-imports` `patterns` group: the `$alias` form plus any relative
// or `src/`-rooted form (`**/` also matches leading `../` segments), each bare
// and with a `.ts` / `.js` extension. `aliasRoot` is the `$alias` whose target
// directory is the first segment of `modulePath` (see svelte.config.js).
//
// `no-restricted-imports` compares source strings and never resolves modules,
// so a `paths` entry (or a hand-written partial `patterns` group) bans only the
// spelling it names and lets the relative or extension-bearing import of the
// same file through (cloudlands-fe#2763 review). Every internal-module ban in
// eslint.config.js goes through this helper, and
// scripts/check-restricted-import-spellings.mjs imports it standalone to check
// that each internal-module group is exactly the covering set. Keep this module
// free of eslint.config.js (and any other config) imports for that reason.
export function internalModuleImportPatterns(aliasRoot, modulePath) {
  const aliasForm = modulePath.replace(/^[^/]+/, aliasRoot);
  return [aliasForm, `**/${modulePath}`].flatMap((base) => [base, `${base}.ts`, `${base}.js`]);
}
