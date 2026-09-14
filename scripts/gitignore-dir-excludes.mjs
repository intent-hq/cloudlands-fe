import { readFileSync } from 'node:fs';

// Derives vitest exclude globs from .gitignore's directory-style entries, so
// .gitignore stays the single source of truth for scratch/sandbox exclusions
// (matches eslint.config.js's includeIgnoreFile usage, intent-hq/cloudlands-fe#2322).
// Only trimmed lines ending in '/' are considered; blanks, comments, and '!'
// negations are skipped. Unanchored entries (no '/' before the trailing one,
// e.g. '.dev/') become '**/<pattern>/**'; anchored entries (containing a '/',
// e.g. 'build/ios/') become '<pattern>/**' with any leading '/' stripped.
/**
 * @param {string} text .gitignore contents
 * @returns {string[]}
 */
export function gitignoreDirExcludesFromText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!') && line.endsWith('/'))
    .map((line) => {
      const pattern = line.slice(0, -1);
      return pattern.includes('/') ? `${pattern.replace(/^\//, '')}/**` : `**/${pattern}/**`;
    });
}

/**
 * @param {string} gitignorePath path to a .gitignore file
 * @returns {string[]}
 */
export function gitignoreDirExcludes(gitignorePath) {
  return gitignoreDirExcludesFromText(readFileSync(gitignorePath, 'utf8'));
}
