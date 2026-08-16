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
    const browser = source('../workspace/SidebarBrowserLauncher.svelte');
    const terminal = source('../workspace/WorkspaceTerminalDock.svelte');
    const strip = source('../workspace/SidebarExpandedTabStrip.svelte');
    const transitions = source('../workspace/multi-select-sidebar-transitions.css');
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
    expect(sidebar).toContain('border border-border bg-sidebar p-2');
    expect(sidebar).toContain('border border-border bg-sidebar"');
    expect(sidebar).toContain('background-color: hsl(var(--sidebar))');
    expect(browser).toContain('border border-border bg-sidebar px-3');
    expect(terminal).toContain('border border-border bg-sidebar px-3');
    expect(strip).toContain('border border-border bg-sidebar px-4!');
    expect(transitions).toContain('background-color: hsl(var(--sidebar))');
  });

  it('migrates panel tabs, compact headers, and empty or recent items', () => {
    const tabBar = source('../layout/panel-system/PanelTabBar.svelte');
    const empty = source('../layout/panel-system/PanelEmptyState.svelte');
    const navigator = source('../chat/ChatMessageNavigator.svelte');
    const scrollButton = source('../chat/ScrollToBottomButton.svelte');
    const chatSizes = source('../chat/chat-icon-size.ts');

    expect(tabBar).toContain('<ResourceIconTile kind={resourceKind} />');
    expect(tabBar).toContain('<ResourceIconTile kind={activeResourceKind} />');
    expect(tabBar).toContain('data-panel-header-leading-surface');
    expect(tabBar).toContain('size={12}');
    expect(tabBar).toContain('width="12"');
    expect(tabBar).not.toMatch(/size=\{14\}|width="14"|height="14"/);
    expect(tabBar).toContain('<KebabIcon class="pointer-events-none size-3!" />');
    expect(tabBar).toContain('<Fa icon={faXmark} size={12} class="size-3!" />');
    expect(navigator).toContain('size={CHAT_ICON_SIZE.header} class="size-3!"');
    expect(scrollButton).toContain('size={CHAT_ICON_SIZE.navigationArrow} class="size-[11px]!"');
    expect(chatSizes).toContain('header: 12');
    expect(chatSizes).toContain('navigationArrow: 11');
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
