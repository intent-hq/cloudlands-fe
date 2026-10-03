<script lang="ts">
  import type { Workspace } from '$shared/types';
  import { onMount, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { store as appStore } from '$store/renderer/store';
  import { selectNotePageSession } from '$store/renderer/slices/note-pages/note-pages-selectors';
  import {
    pagePanelOpened,
    pagePanelClosed,
    pageWindowRequested,
    pageVisibleRangesChanged,
  } from '$store/renderer/slices/note-pages/note-pages-slice';
  import {
    NoteWindowView,
    type NoteSourceSelection,
    type NoteViewEditing,
  } from './note-window-view';
  import { m } from '$shared/paraglide/messages.js';
  let {
    workspaceId,
    workspace,
    noteId,
    panelId,
    onSelection = () => {},
    onFullOperation,
    onReady,
    editing,
    ownsPanel = true,
  }: {
    workspaceId: string;
    workspace?: Workspace;
    noteId: string;
    panelId: string;
    onSelection?: (selection: NoteSourceSelection) => void;
    onFullOperation: (
      kind: 'copy' | 'search' | 'selectAll',
      selection: NoteSourceSelection,
    ) => void;
    onReady?: (view: NoteWindowView) => void;
    editing?: NoteViewEditing;
    ownsPanel?: boolean;
  } = $props();
  // Selector targets follow props; no note's pages can leak into a reused panel.
  // svelte-ignore state_referenced_locally
  const ws = writable(workspaceId);
  // svelte-ignore state_referenced_locally
  const id = writable(noteId);
  $effect(() => ws.set(workspaceId));
  $effect(() => id.set(noteId));
  const session = selectNotePageSession(ws, id);
  const current = $derived($session?.windows[panelId]);
  let element: HTMLDivElement;
  let view: NoteWindowView | undefined = $state();
  let mounted = $state(false);
  let renderError = $state(false);
  onMount(() => {
    mounted = true;
    return () => {
      mounted = false;
    };
  });
  $effect(() => {
    if (!mounted) return;
    const owner = { workspaceId, noteId, panelId };
    const openPanelHere = ownsPanel;
    if (openPanelHere)
      appStore.dispatch(pagePanelOpened(owner.workspaceId, owner.noteId, owner.panelId));
    appStore.dispatch(pageWindowRequested(owner.workspaceId, owner.noteId, owner.panelId, 0));
    const native = new NoteWindowView(element, {
      seek: (at) =>
        appStore.dispatch(pageWindowRequested(owner.workspaceId, owner.noteId, owner.panelId, at)),
      selectionChanged: (s) => onSelection(s),
      fullOperation: (kind, selection) => onFullOperation(kind, selection),
      workspace,
      editing,
      changed: () => {
        const range = native.window?.range;
        if (range)
          appStore.dispatch(
            pageVisibleRangesChanged(owner.workspaceId, owner.noteId, owner.panelId, [range]),
          );
      },
    });
    view = native;
    untrack(() => onReady?.(native));
    return () => {
      native.destroy();
      if (openPanelHere)
        appStore.dispatch(pagePanelClosed(owner.workspaceId, owner.noteId, owner.panelId));
    };
  });
  $effect(() => {
    const window = current?.value;
    if (!window || !view) return;
    try {
      view.show(window);
      renderError = false;
    } catch {
      renderError = true;
    }
  });
</script>

<div
  class="h-full min-h-0 overflow-auto"
  bind:this={element}
  aria-label={m.workspace_noteWithComments_editor_ariaLabel()}
></div>
{#if current?.error || renderError}
  <div role="alert">{m.layout_noteTab_contentLoadFailed_error()}</div>
{/if}
