import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('resource icon tile source contract', () => {
  it('uses the canonical standard surface and opaque semantic neutral colors', () => {
    const tile = source('./ResourceIconTile.svelte');

    expect(tile).toContain('var(--agent-avatar-standard-surface-size)');
    expect(tile).toContain('var(--agent-avatar-standard-corner-radius)');
    expect(tile).toContain('background: hsl(var(--muted))');
    expect(tile).toContain('color: hsl(var(--muted-foreground))');
    expect(tile.match(/width: 12px/g)).toHaveLength(2);
    expect(tile.match(/height: 12px/g)).toHaveLength(2);
    expect(tile).not.toMatch(/#[0-9a-f]{3,8}|gradient|opacity:/i);
  });

  it('migrates every scoped sidebar resource surface without changing task-state icons', () => {
    const sidebar = source('../workspace/MultiSelectTabbedSidebar.svelte');
    const notes = source('../workspace/sidebar/NotesPanel.svelte');
    const context = source('../workspace/sidebar/ContextItemRow.svelte');
    const tabs = source('../workspace/multi-select-sidebar-tabs.ts');

    expect(sidebar).toMatch(/<ResourceIconTile\s+kind="note"/);
    expect(sidebar).toContain('<ResourceIconTile kind="changes" />');
    expect(sidebar).not.toContain('$lib/icons/faNote');
    expect(notes.match(/<ResourceIconTile kind="note" \/>/g)).toHaveLength(2);
    expect(notes).toContain('<TaskStatusIcon');
    expect(notes).toContain('{:else if hasTasks}');
    expect(context).toContain("{#if item.type === 'note'}");
    expect(context).toContain('<ResourceIconTile kind="note" />');
    expect(tabs).toContain('icon: RESOURCE_ICON_BY_KIND.note');
    expect(tabs).toContain('icon: RESOURCE_ICON_BY_KIND.changes');
  });

  it('migrates panel tabs, compact headers, and empty or recent items', () => {
    const tabBar = source('../layout/panel-system/PanelTabBar.svelte');
    const empty = source('../layout/panel-system/PanelEmptyState.svelte');

    expect(tabBar).toContain('<ResourceIconTile kind={resourceKind} />');
    expect(tabBar).toContain('<ResourceIconTile kind={activeResourceKind} />');
    expect(tabBar).toContain('data-panel-header-leading-surface');
    expect(tabBar).toContain('size={12}');
    expect(tabBar).toContain('width="12"');
    expect(tabBar).not.toMatch(/size=\{14\}|width="14"|height="14"/);
    expect(tabBar).not.toContain('pl-4 pr-2.5 sm:pl-6');
    expect(tabBar).toContain(
      '(var(--panel-header-height) - var(--agent-avatar-standard-surface-size)) / 2',
    );
    expect(empty).toContain('<ResourceIconTile kind={action.resourceKind} />');
    expect(empty).toContain('<ResourceIconTile kind={resourceKind} />');
  });

  it('maps the note and every changes alias to one canonical identity', () => {
    const icons = source('./resource-icon.ts');
    const registry = source('../../../features/layout/tab-types/register-all.ts');

    for (const type of ['changes', 'local-changes', 'chat-changes', 'activity-changes']) {
      expect(icons).toContain(`${type.includes('-') ? `'${type}'` : type}: 'changes'`);
    }
    expect(icons).toContain("note: 'note'");
    expect(registry.match(/icon: RESOURCE_ICON_BY_KIND\.changes/g)).toHaveLength(4);
    expect(registry).toContain('icon: RESOURCE_ICON_BY_KIND.note');
  });
});
