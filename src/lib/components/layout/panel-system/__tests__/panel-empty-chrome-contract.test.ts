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

    expect(emptyState).toContain('creation-grid grid gap-1.5');
    expect(emptyState).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(emptyState).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(emptyState).toContain('min-h-16 cursor-pointer');
    expect(emptyState).toContain('bg-sidebar px-6 py-10 text-foreground');
    expect(emptyState).not.toContain('border-t border-border');
  });

  it('closes tabless panels from their semantic header without making the panel focusable', () => {
    const panel = source('../Panel.svelte');
    const tabBar = source('../PanelTabBar.svelte');

    expect(panel).not.toContain('data-empty-panel-close');
    expect(panel).not.toContain('tabindex="-1"');
    expect(tabBar).toContain('data-empty-panel-header');
    expect(tabBar).toContain('{@render panelColumnCountMenu()}');
    expect(tabBar).toContain('{@render panelCloseButton()}');
  });

  it('keeps empty-state actions pristine until their content replaces the panel', () => {
    const panel = source('../Panel.svelte');
    const emptyState = source('../PanelEmptyState.svelte');

    expect(emptyState).toContain('data-panel-empty-state');
    expect(panel).toContain("target.closest('[data-panel-empty-state]')");
    expect(panel).toContain('if (!isEmptyStateInteraction(event.target)) markUserTouch()');
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
