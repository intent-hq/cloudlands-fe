<script lang="ts">
  import type { Workspace } from '$shared/types';
  import { onMount, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { v4 as uuid } from 'uuid';
  import { store as appStore } from '$store/renderer/store';
  import {
    selectNotePageSession,
    selectNoteResourceHeld,
  } from '$store/renderer/slices/note-pages/note-pages-selectors';
  import {
    pagePanelOpened,
    pagePanelClosed,
    pageWindowRequested,
    pageVisibleRangesChanged,
    pageWindowRetained,
    pageResourcesReleased,
  } from '$store/renderer/slices/note-pages/note-pages-slice';
  import {
    NoteWindowView,
    type NoteSourceSelection,
    type NoteViewEditing,
    type NoteReadingSurface,
  } from './note-window-view';
  import { prepareNoteWindowDisplay } from './note-window-preparation';
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
    prepareEditing,
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
    prepareEditing?: NoteReadingSurface['prepareEditing'];
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
  const ready = $derived($session?.status === 'ready');
  const panelOpen = $derived(!!$session?.panels[panelId]);
  const unavailable = $derived(
    $session?.status === 'error' || $session?.status === 'deleted' || $session?.status === 'legacy',
  );
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
    const native = new NoteWindowView(element, {
      seek: (at) =>
        appStore.dispatch(pageWindowRequested(owner.workspaceId, owner.noteId, owner.panelId, at)),
      retainWindow: (value) => {
        const generation = selectNotePageSession.select(
          appStore.state,
          owner.workspaceId,
          owner.noteId,
        )?.generation;
        if (generation === undefined) throw new Error('Note window owner is unavailable');
        const lease = `runtime-window:${uuid()}`;
        appStore.dispatch(
          pageWindowRetained(
            owner.workspaceId,
            owner.noteId,
            owner.panelId,
            generation,
            value,
            lease,
          ),
        );
        if (!selectNoteResourceHeld.select(appStore.state, lease))
          throw new Error('Note window data admission was lost');
        return () => appStore.dispatch(pageResourcesReleased(lease));
      },
      selectionChanged: (s) => onSelection(s),
      fullOperation: (kind, selection) => onFullOperation(kind, selection),
      workspace: untrack(() => workspace),
      editing: untrack(() => (ready ? editing : undefined)),
      failed: () => {
        renderError = true;
      },
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
  // When the parent owns negotiation its opening effect may run after this
  // child mounts. A batched close/reopen can keep panelOpen true while deleting
  // its window. Restore missing demand, without retrying loading/error descriptors.
  $effect(() => {
    if (!mounted || !panelOpen || current) return;
    const owner = { workspaceId, noteId, panelId };
    untrack(() =>
      appStore.dispatch(pageWindowRequested(owner.workspaceId, owner.noteId, owner.panelId, 0)),
    );
  });
  $effect(() => {
    const native = view;
    const window = current?.value;
    const available = ready;
    const supplied = editing;
    const prepare = prepareEditing;
    if (!native) return;
    if (!available || !prepare) native.updateEditing(available ? supplied : undefined);
    if (!available || !window) return;
    const show = (prepared?: NoteViewEditing) => {
      try {
        native.showPrepared(window, prepared);
        renderError = false;
      } catch {
        renderError = true;
      }
    };
    if (!prepare) {
      show(supplied);
      return;
    }
    return untrack(() =>
      prepareNoteWindowDisplay(window, prepare, show, () => {
        renderError = true;
      }),
    );
  });
</script>

<div class="flex h-full min-h-0 flex-col">
  {#if unavailable || current?.error || renderError}
    <div class="shrink-0" role="alert">{m.layout_noteTab_contentLoadFailed_error()}</div>
  {/if}
  <div
    class="min-h-0 flex-1 overflow-auto"
    bind:this={element}
    inert={!ready}
    aria-busy={!ready && !unavailable}
    aria-label={m.workspace_noteWithComments_editor_ariaLabel()}
  ></div>
</div>
