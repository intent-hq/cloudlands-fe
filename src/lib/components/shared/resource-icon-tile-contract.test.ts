// @verify-changed-triggers: ./ResourceIconTile.svelte, ./resource-icon.ts,
//   ../workspace/MultiSelectTabbedSidebar.svelte, //   ../workspace/multi-select-sidebar-tabs.ts,
//   ../workspace/sidebar/NotesPanel.svelte, ../workspace/sidebar/ContextItemRow.svelte,
//   ../layout/panel-system/PanelTabBar.svelte, ../layout/panel-system/PanelEmptyState.svelte,
//   ../chat/ChatMessageNavigator.svelte, ../chat/ScrollToBottomButton.svelte,
//   ../chat/chat-icon-size.ts, ../../../features/layout/tab-types/register-all.ts

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('resource icon tile source contract', () => {
  it('uses the canonical standard surface and opaque semantic neutral colors', () => {
    const tile = source('./ResourceIconTile.svelte');

    expect(tile).toContain(
      '--resource-icon-surface-size: var(--agent-avatar-standard-surface-size)',
    );
    expect(tile).toContain(
      '--resource-icon-corner-radius: var(--agent-avatar-standard-corner-radius)',
    );
    expect(tile).toContain('--resource-icon-glyph-size: 12px');
    expect(tile).toContain(
      '--resource-icon-surface-size: var(--agent-avatar-emphasized-surface-size)',
    );
    expect(tile).toContain(
      '--resource-icon-corner-radius: var(--agent-avatar-emphasized-corner-radius)',
    );
    expect(tile).toContain('background: hsl(var(--muted))');
    expect(tile).toContain('color: hsl(var(--muted-foreground))');
    expect(tile.match(/width: var\(--resource-icon-glyph-size\)/g)).toHaveLength(2);
    expect(tile.match(/height: var\(--resource-icon-glyph-size\)/g)).toHaveLength(2);
    expect(tile).not.toMatch(/#[0-9a-f]{3,8}|gradient|opacity:/i);
  });

  it('migrates every scoped sidebar resource surface without changing task-state icons', () => {
    const notes = source('../workspace/sidebar/NotesPanel.svelte');
    const context = source('../workspace/sidebar/ContextItemRow.svelte');
    const tabs = source('../workspace/multi-select-sidebar-tabs.ts');

    expect(notes.match(/<ResourceIconTile kind="note" \/>/g)).toHaveLength(2);
    expect(notes).toContain('<TaskStatusIcon');
    expect(notes).toContain('{:else if hasTasks}');
    expect(context).toContain("{#if item.type === 'note'}");
    expect(context).toContain('<ResourceIconTile kind="note" />');
    expect(tabs).toContain('icon: RESOURCE_ICON_BY_KIND.note');
    expect(tabs).toContain('icon: RESOURCE_ICON_BY_KIND.changes');
  });

  it('migrates panel tabs and compact headers while empty rows use bare glyphs', () => {
    const tabBar = source('../layout/panel-system/PanelTabBar.svelte');
    const empty = source('../layout/panel-system/PanelEmptyState.svelte');
    const navigator = source('../chat/ChatMessageNavigator.svelte');
    const scrollButton = source('../chat/ScrollToBottomButton.svelte');
    const chatSizes = source('../chat/chat-icon-size.ts');

    expect(tabBar).toContain('<ResourceIconTile kind={resourceKind} />');
    expect(tabBar).toContain(
      "<ResourceIconTile kind={resourceKind} variant={compact ? 'standard' : 'emphasized'} />",
    );
    expect(tabBar).toContain('{@render panelIdentity(activeTab)}');
    expect(tabBar).toContain('data-panel-header-leading-surface');
    expect(tabBar).toContain('size={16}');
    // Rendered action ink, hit targets and keyboard routing are covered by agent-header-icons.ct.spec.ts.
    expect(navigator).toContain("import ChatTextIcon from 'phosphor-svelte/lib/ChatTextIcon'");
    expect(navigator).toMatch(
      /<ChatTextIcon[\s\S]*?size=\{CHAT_ICON_SIZE\.compact\}[\s\S]*?mirrored=\{false\}/,
    );
    expect(navigator).toContain('data-chat-message-navigator-chat-icon');
    expect(navigator).not.toContain('faList');
    expect(scrollButton).toMatch(
      /<ArrowDownIcon[\s\S]*?size=\{CHAT_ICON_SIZE\.compact\}[\s\S]*?class="size-4!"/,
    );
    expect(chatSizes).toContain('header: 12');
    expect(chatSizes).toContain('compact: 16');
    expect(tabBar).not.toContain('pl-4 pr-2.5 sm:pl-6');
    expect(empty).not.toContain('ResourceIconTile');
    expect(empty).toContain('<Fa icon={action.icon} class="size-[1em]" />');
    expect(empty).toContain('<Fa icon={row.icon} class="size-[1em]" />');
    expect(empty).toContain('icon: getTabIcon(item.tab.type)');
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
