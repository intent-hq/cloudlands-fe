import type { ShortcutId } from './shortcut-bindings';

export interface RuntimeShortcutConsumer {
  source: string;
  handler: string;
}

/**
 * Exhaustive audit of editable Settings rows and the runtime code that resolves each binding.
 * The `satisfies` constraint makes adding a registry row without a consumer a type error.
 */
export const SHORTCUT_RUNTIME_CONSUMERS = {
  'global.command-palette': { source: 'routes/(app)/+layout.svelte', handler: 'keyboard manager' },
  'global.settings': { source: 'routes/(app)/+layout.svelte', handler: 'keyboard manager' },
  'global.keyboard-shortcuts': {
    source: 'routes/(app)/+layout.svelte',
    handler: 'keyboard manager',
  },
  'global.command-palette-alt': {
    source: 'routes/(app)/+layout.svelte',
    handler: 'keyboard manager',
  },
  'global.toggle-spaces': { source: 'routes/(app)/+layout.svelte', handler: 'keyboard manager' },
  'global.new-space': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'global.search': { source: 'routes/(app)/+layout.svelte', handler: 'keyboard manager' },
  'global.next-space': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'global.previous-space': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'navigation.go-to-tab': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'expanded range registrations',
  },
  'navigation.new-tab': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'navigation.close-tab': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'navigation.close-space-tab': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'navigation.reopen-tab': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'navigation.move-space-tab-left': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'navigation.move-space-tab-right': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'workspace.new-agent': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'workspace.new-note': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'workspace.new-terminal': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'workspace.new-browser': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'chat.send': {
    source: 'lib/components/chat/input/TipTapEditor.svelte',
    handler: 'editor keydown',
  },
  'chat.force-send': {
    source: 'lib/components/chat/input/TipTapEditor.svelte',
    handler: 'editor keydown',
  },
  'chat.new-line': {
    source: 'lib/components/chat/input/TipTapEditor.svelte',
    handler: 'editor keydown',
  },
  'chat.focus-input': { source: 'lib/components/chat/ChatPanel.svelte', handler: 'panel keydown' },
  'chat.mention-context': {
    source: 'lib/components/chat/input/TipTapEditor.svelte',
    handler: 'editor keydown',
  },
  'editor.go-to-line': { source: 'routes/(app)/+layout.svelte', handler: 'keyboard manager' },
  'editor.save': {
    source: 'features/layout/tab-types/FileTabType.svelte',
    handler: 'file keydown',
  },
  'editor.undo': {
    source: 'features/layout/tab-types/FileTabType.svelte',
    handler: 'editor command bridge',
  },
  'editor.redo': {
    source: 'features/layout/tab-types/FileTabType.svelte',
    handler: 'editor command bridge',
  },
  'editor.toggle-task-list': {
    source: 'features/layout/tab-types/FileTabType.svelte',
    handler: 'markdown command bridge',
  },
  'editor.toggle-word-wrap': { source: 'routes/(app)/+layout.svelte', handler: 'keyboard manager' },
  'editor.copy': {
    source: 'features/layout/tab-types/FileTabType.svelte',
    handler: 'editor command bridge',
  },
  'editor.select-all': {
    source: 'features/layout/tab-types/FileTabType.svelte',
    handler: 'editor command bridge',
  },
  'panel.toggle-sidebar': {
    source: 'features/workspace/utils/workspace-tab-navigation.ts',
    handler: 'keyboard manager',
  },
  'panel.create-column-right': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.focus-next-column': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.maximize': {
    source: 'lib/components/layout/panel-system/PanelTabBar.svelte',
    handler: 'panel keydown',
  },
  'panel.focus-previous-column': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.next-pane': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.previous-pane': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.move-pane-next-column': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.move-pane-previous-column': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'panel keydown',
  },
  'panel.copy-browser-url': {
    source: 'lib/components/browser/EmbeddedBrowser.svelte',
    handler: 'browser keydown',
  },
  'leader.navigate-panels': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.resize-panels': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.split-right': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.toggle-zoom': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.close-panel': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.next-previous-panel': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.equalize-sizes': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
  'leader.jump-to-panel': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader sequence',
  },
  'leader.cycle-layout': {
    source: 'features/layout/panel-keyboard-shortcuts.svelte.ts',
    handler: 'leader pattern',
  },
} as const satisfies Record<ShortcutId, RuntimeShortcutConsumer>;
