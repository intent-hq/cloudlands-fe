<script lang="ts">
  import { onDestroy } from 'svelte';
  import { ContentType, NoteVisibility, type Note } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    clearWorkspaceNotesForWorkspaces,
    loadWorkspaceNotesSucceeded,
  } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import NoteTabType from '../../NoteTabType.svelte';

  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const workspaceId = 'note-panel-menu-ct';
  const note: Note = {
    id: NoteId('menu-note'),
    workspaceId: WorkspaceId(workspaceId),
    title: 'Menu acceptance note',
    content: '# Menu acceptance\n\nCopy the complete note.',
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  };
  store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: [note] }));
  const tab: PanelTab = {
    id: 'note-menu-tab',
    type: 'note',
    title: note.title,
    noteId: note.id,
    closable: true,
  };
  const header = createPanelHeaderContext();
  onDestroy(() => {
    store.dispatch(clearWorkspaceNotesForWorkspaces([workspaceId]));
    dispose();
  });
</script>

<!-- The real note registers its production snippets; no menu items are copied into the fixture.
     No workspace record is seeded: the editor and its backend lifecycle are outside this test. -->
<section class="w-full overflow-hidden bg-background text-foreground" data-testid="note-menu-host">
  <PanelTabBar
    tabs={[tab]}
    activeTabId={tab.id}
    panelId="note-menu-panel"
    {workspaceId}
    isFocused
    contentActions={header.actions.current}
  />
  <NoteTabType {tab} {workspaceId} isActive isPanelFocused />
</section>
