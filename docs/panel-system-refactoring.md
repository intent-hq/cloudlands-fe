# Panel System Refactoring

## Overview

This document describes the panel system refactoring work completed to improve code organization, fix bugs, and lay groundwork for future features.

## What Was Built

### 1. Tab Type Registry System

**Problem**: `PanelContentRenderer.svelte` was a 1800+ line file with a massive if/else chain handling the app's 14 registered tab types. This made it hard to maintain, test, and extend.

**Solution**: Created a registry-based architecture where each tab type is a standalone component.

**Files Created**:
- `src/features/layout/tab-types/registry.ts` - Registry infrastructure
- `src/features/layout/tab-types/register-all.ts` - Registers all tab types at app startup
- 14 registered tab type components in `src/features/layout/tab-types/`:
  - `AgentTabType.svelte` - Chat panel with agent conversations
  - `NoteTabType.svelte` - Note editor with version history
  - `FileTabType.svelte` - Code editor with auto-save
  - `DiffTabType.svelte` - Diff viewer for file changes
  - `ChangesTabType.svelte` - Commit changeset viewer
  - `LocalChangesTabType.svelte` - Local git changes
  - `ChatChangesTabType.svelte` - Changes from agent turns
  - `ActivityChangesTabType.svelte` - Activity event diffs
  - `BrowserTabType.svelte` - Embedded browser
  - `TerminalTabType.svelte` - Terminal emulator
  - `CodeReviewTabType.svelte` - Code review panel
  - `AgentOverviewTabType.svelte` - Agent overview
  - `SettingsTabType.svelte` - Settings panel
  - `OverviewTabType.svelte` - Workspace overview

**How It Works**:
```typescript
// Each tab type is registered with its component, icon, and metadata
tabTypeRegistry.register({
  type: 'agent',
  component: AgentTabType,
  icon: faComment,
  defaultTitle: 'Agent',
  categoryLabel: 'Agents',
  sidebarTabId: 'agents',
  renameable: true,
});

// PanelContentRenderer now just looks up and renders
const TabComponent = tabTypeRegistry.get(tab.type)?.component;
<TabComponent {tab} {workspaceId} {isActive} {isPanelFocused} {onFocus} />
```

### 2. Modifier Key Support (Cmd+Click)

**Problem**: Inconsistent behavior when Cmd+clicking (or Ctrl+clicking) links and items. Some opened in adjacent panels, others didn't.

**Solution**: Audited entire codebase and fixed 6+ locations where modifier key support was missing.

**Pattern Used**:
```typescript
onclick={(e) => {
  const openInAdjacentPanel = e.metaKey || e.ctrlKey;
  const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
  const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;

  if (openInAdjacentPanel) {
    layoutManager.openTabInAdjacentOrSplit(tabData, sourcePanelId);
  } else {
    layoutManager.openTab(tabData);
  }
}}
```

**Files Fixed**:
- `ToolDetails.svelte` - File links in tool call details
- `AgentActionBlock.svelte` - Agent links in notes
- `ContentNavigationRail.svelte` - Agent and note links
- `ChatChangesPanel.svelte` - Diff file links
- `AcceptChangesPanel.svelte` - File click handling
- `FileRow.svelte` - File row clicks
- `ActivityLog.svelte` / `ActivityTimeline.svelte` - Activity item clicks

### 3. Layout Persistence Fixes

**Problem**: Default layouts weren't being persisted, and spec notes kept auto-opening even when intentionally closed.

**Solution**:
- Fixed `persistLayout()` to save default layouts to localStorage
- Added `userClosedSpecNote` flag to track intentional closes

### 4. Architectural Hooks

**Added for future features** (not currently used):

```typescript
// In WorkspacePanelLayout interface
detachedPanels?: Record<string, {
  panelId: string;
  windowId: string;
  alwaysOnTop: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}>;
```

This enables future pop-out panel functionality.

## Architecture

### Tab Type Component Interface

All tab type components implement this interface:

```typescript
interface TabTypeComponentProps {
  tab: PanelTab;
  workspaceId: string;
  isActive: boolean;
  isPanelFocused: boolean;
  onFocus?: () => void;
}
```

### Registry metadata

Each tab type definition now includes:

- `type` - unique tab type key
- `component` - Svelte component for rendering
- `icon` - icon shown in tab bars and headers
- `defaultTitle` - title used when creating new tabs of this type
- `categoryLabel` - grouping label used by the panel system
- `sidebarTabId?` - optional sidebar target for “Reveal in Sidebar”
- `renameable?` - whether users can rename tabs of this type

### Header Actions

Each tab type registers its own header actions via the panel header context:

```typescript
const headerContext = getPanelHeaderContext();

$effect(() => {
  if (!headerContext || !isActive) return;
  headerContext.registerActions(myActionsSnippet);
  headerContext.registerState({ subtitle: 'My subtitle' });
});
```

## Files Modified

### Core Panel System
- `src/lib/components/layout/panel-system/PanelContentRenderer.svelte` - Simplified to use registry
- `src/lib/components/layout/panel-system/PanelTabBar.svelte` - Uses registry for tab display

### Layout Management
- `src/features/layout/panel-layout-manager.svelte.ts` - Added detachedPanels support
- `src/features/layout/types.ts` - Added DetachedPanelInfo interface

## Testing

After these changes, verify:
1. All 14 tab types render correctly
2. Cmd+click opens items in adjacent panels
3. Layout persists across page reloads
4. Closing spec note stays closed until manually reopened
5. Header actions appear correctly for each tab type

## Future Work

1. **Pop-out panels** - Use detachedPanels infrastructure to enable floating windows
2. **TweetDeck layouts** - Multi-column layouts with independent scrolling
