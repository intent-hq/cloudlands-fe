import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function collectSvelteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectSvelteFiles(path);
    return extname(path) === '.svelte' ? [path] : [];
  });
}

describe('empty panel chrome', () => {
  it('uses a balanced two-by-two creation grid with explicit pointer affordances', () => {
    const emptyState = source('../PanelEmptyState.svelte');

    expect(emptyState).toContain('grid grid-cols-2 gap-2 sm:grid-cols-6');
    expect(emptyState).toContain('sm:col-span-3');
    expect(emptyState).toContain('min-h-24 cursor-pointer flex-col');
    expect(emptyState).not.toContain('border-t border-border');
  });

  it('closes tabless panels without making the panel itself focusable', () => {
    const panel = source('../Panel.svelte');

    expect(panel).toContain('data-empty-panel-close');
    expect(panel).not.toContain('tabindex="-1"');
  });

  it('uses UI typography for every keyboard shortcut', () => {
    const appCss = source('../../../../../app.css');
    const svelteSource = collectSvelteFiles(resolve(process.cwd(), 'src'))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    expect(appCss).toContain('kbd {\n  font-family: var(--font-ui);');
    expect(appCss).toContain(':where(button:not(:disabled), a[href]');
    expect(svelteSource).not.toMatch(/<kbd[^>]*font-mono/);
  });
});
