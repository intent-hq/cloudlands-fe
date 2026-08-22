import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'vite.config.mjs'), 'utf8');

describe('renderer HMR watcher', () => {
  it('leaves SvelteKit reserved app modules to the SvelteKit plugin', () => {
    expect(source).not.toContain("{ find: '$app'");
  });

  it('ignores test-only changes that would otherwise reload the app', () => {
    expect(source).toContain("'**/*.test.*'");
    expect(source).toContain("'**/*.spec.*'");
    expect(source).toContain("'**/__tests__/**'");
    expect(source).toContain("'**/tests/**'");
  });

  it('blocks leaked test events before Vite can request a page reload', () => {
    expect(source).toContain('const isTestOnlyFile =');
    expect(source).toContain('/\\.(test|spec)\\.[^/]+$/');
    expect(source).toContain('isTestOnlyFile ||');
  });

  it('ignores nested .intent isolated worktrees so they cannot stall the dev server', () => {
    // Watcher exclusion: nested worktree SvelteKit output (.svelte-kit/tsconfig.json)
    // must never reach Vite's tsconfig cache-clear / full-reload path (monorepo#3150).
    expect(source).toContain("'**/.intent/**'");
    // Backstop for plain HMR events only — the tsconfig full-reload path fires in
    // Vite core before plugins run, so the watcher ignore above is the real fix.
    expect(source).toContain("normalizedFile.includes('/.intent/')");
  });
});
