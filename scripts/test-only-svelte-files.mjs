// File-name endings that mark a Svelte file as test-only support (a harness or host that a
// spec mounts). knip's production pass, the UI component audits, the catalog contract and the
// design-system lint all read this list, so a file named with one of these endings is test
// code to every check. knip.jsonc cannot import it; test-only-svelte-files.test.ts keeps its
// glob in step.

/** @type {readonly string[]} */
export const TEST_ONLY_SVELTE_SUFFIXES = Object.freeze([
  'Harness',
  '-harness',
  '.test-harness',
  '.test',
  'TestHost',
]);

const TEST_ONLY_SVELTE_FILE = new RegExp(
  `(?:${TEST_ONLY_SVELTE_SUFFIXES.map((suffix) => suffix.replace(/[.-]/g, '\\$&')).join('|')})\\.svelte$`,
);

/**
 * @param {string} file A path or file name.
 * @returns {boolean}
 */
export function isTestOnlySvelteFile(file) {
  return TEST_ONLY_SVELTE_FILE.test(file);
}
