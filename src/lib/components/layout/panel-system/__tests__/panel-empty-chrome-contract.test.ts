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
  it('uses one narrow typographic grid without icon tiles or filled row states', () => {
    const emptyState = source('../PanelEmptyState.svelte');

    expect(emptyState).toContain('empty-state-content type-caption');
    expect(emptyState).toContain('max-w-[20rem]');
    expect(emptyState).toContain('creation-list flex flex-col gap-0.5');
    expect(emptyState).toContain('creation-action empty-state-row grid min-h-7');
    expect(emptyState).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(emptyState).not.toContain('ResourceIconTile');
    expect(emptyState).not.toContain('hover:bg-');
    expect(emptyState).not.toContain('min-h-16');
    expect(emptyState).not.toContain('creation-grid');
    expect(emptyState).toContain('bg-sidebar px-6 py-8 text-foreground');
    expect(emptyState).not.toContain('border-t border-border');
  });

  it('removes elevation from tabless shells while preserving their focus border', () => {
    const panel = source('../Panel.svelte');

    expect(panel).toContain(
      "data-empty-panel-shell={panel.tabs.length === 0 ? 'true' : undefined}",
    );
    expect(panel).toMatch(
      /\.panel\[data-empty-panel-shell='true'\]:not\(\[data-focus-border-visible='true'\]\)\s*\{\s*border-width: 0;/,
    );
    expect(panel).toMatch(/\.panel\[data-empty-panel-shell='true'\]\s*\{\s*box-shadow: none;/);
    expect(panel).toMatch(
      /\.panel\s*\{[\s\S]*?border: 1px solid transparent;[\s\S]*?box-shadow: var\(--elevation-raised\);/,
    );
    expect(panel).toMatch(
      /\.panel\[data-focus-border-visible='true'\]\s*\{\s*border-color: hsl\(var\(--border\)\);/,
    );
  });

  it('keeps a visible inset keyboard outline on every empty-state row', () => {
    const emptyState = source('../PanelEmptyState.svelte');

    expect(emptyState.match(/focus-visible:outline-ring/g)).toHaveLength(4);
    expect(emptyState).not.toContain('focus-visible:outline-none');
  });

  it('closes tabless panels from their semantic header without making the panel focusable', () => {
    const panel = source('../Panel.svelte');
    const tabBar = source('../PanelTabBar.svelte');

    expect(panel).not.toContain('data-empty-panel-close');
    expect(panel).not.toContain('tabindex="-1"');
    expect(tabBar).toContain('data-empty-panel-header');
    expect(tabBar).toContain('{@render addPanelColumnButton()}');
    expect(tabBar).not.toContain('panelColumnCountMenu');
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
