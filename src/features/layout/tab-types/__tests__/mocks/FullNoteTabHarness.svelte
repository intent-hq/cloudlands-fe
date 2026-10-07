<script lang="ts">
  import { startWorkspaceNotesSagaFixture } from '../../../../../test/fixtures/workspace-notes-saga-fixture';
  import { NoteWindowView } from '$features/notes/virtualized/note-window-view';
  import { selectNotePageSession } from '$store/renderer/slices/note-pages/note-pages-selectors';
  import { onDestroy, untrack } from 'svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { loadWorkspaceNotesSucceeded } from '$store/renderer/slices/workspace-notes/workspace-notes-slice';
  import { createPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { ContentType, NoteVisibility, type Note, type Workspace } from '$shared/types';
  import { NoteId, WorkspaceId } from '$shared/types/branded-ids';
  import {
    installMockElectronBridge,
    type MockBackendMethodHandler,
  } from '../../../../../test/ct-mock-electron-bridge';
  import type { NotePageRequest } from '$lib/client/note-pages';
  import { fullNotePageFixture } from './full-note-page-fixture';
  import NoteTabType from '../../NoteTabType.svelte';
  let {
    initialContent = '# Complete note',
    paging = false,
    failPages = false,
    pageChunk = 1024,
    canonicalPadding = 0,
    nativeClipboard = false,
  } = $props<{
    initialContent?: string;
    paging?: boolean;
    failPages?: boolean;
    pageChunk?: number;
    canonicalPadding?: number;
    nativeClipboard?: boolean;
  }>();
  let viewFailure = $state('');
  const originalShow = NoteWindowView.prototype.show;
  NoteWindowView.prototype.show = function (...args) {
    try {
      return originalShow.apply(this, args);
    } catch (error) {
      untrack(() => {
        viewFailure = String(error);
      });
      throw error;
    }
  };
  onDestroy(() => {
    NoteWindowView.prototype.show = originalShow;
  });
  const workspaceId = 'complete-note-tab-ct';
  const noteId = 'note';
  const pageSession = selectNotePageSession(workspaceId, noteId);
  let source = $state(initialContent),
    rev = 4;
  let methods = $state<string[]>([]);
  const record = (method: string) => untrack(() => methods.push(method));
  let reads = $state(0),
    writes = $state(0);
  const note: Note = {
    id: NoteId(noteId),
    workspaceId: WorkspaceId(workspaceId),
    title: 'Complete note',
    content: '',
    contentLength: initialContent.length,
    rev,
    contentType: ContentType.Markdown,
    visibility: NoteVisibility.Workspace,
    tags: [],
    isPinned: false,
    isArchived: false,
    createdAt: '2026-10-06T00:00:00Z',
    updatedAt: '2026-10-06T00:00:00Z',
  };
  const listeners = new Map<string, (payload: unknown) => void>();
  const scope = { backendId: 'ct-reader', workspaceId, noteId, noteInstanceId: 'i' };
  const identity = () => ({
    scope,
    sourceRevision: 'r' + rev,
    snapshotId: 's' + rev,
    expiresAt: '2099-01-01T00:00:00Z',
  });
  let pageReads = $state(0),
    maxPageAt = $state(0),
    copied = $state(false),
    copyCount = $state(0);
  let clipboardSource = '';
  // The default wire fixture is intentionally an older daemon: viewing must refuse paging
  // without implicitly fetching the full note, while explicit Edit remains usable.
  const handlers: Record<string, MockBackendMethodHandler> = {
    'client.hello': () => {
      record('client.hello');
      return {
        server: {
          capabilities: paging
            ? { notePagingRead: 1, notePagingBackendId: scope.backendId }
            : { notePaging: 1 },
        },
      };
    },
    'note.subscribe': () => {
      record('note.subscribe');
      setTimeout(() => {
        for (const callback of listeners.values())
          callback({
            method: 'subscription.push',
            params: {
              subscriptionId: 'ct-sub',
              seq: 0,
              kind: 'snapshot',
              snapshot: {
                ...identity(),
                kind: 'notePageState',
                stateGeneration: String(rev),
                attributionGeneration: '1',
                attributionState: 'ready',
                commentRevision: '1',
                deleted: false,
                invalidation: 'all',
              },
            },
          });
      }, 0);
      return { subscriptionId: 'ct-sub' };
    },
    'note.unsubscribe': () => {
      record('note.unsubscribe');
      return {};
    },
    'note.get': (params) => {
      const q = (
        params as {
          page?: {
            kind: string;
            at?: number;
            cursor?: string;
            contextRef?: string;
            ref?: string;
            maxSourceBytes?: number;
          };
        }
      ).page;
      if (q) {
        record('note.get:' + q.kind);
        if (failPages) throw new Error('Controlled bounded read failure');
        pageReads++;
        if (q.kind === 'source')
          maxPageAt = Math.max(maxPageAt, q.cursor ? Number(q.cursor.slice(1)) : (q.at ?? 0));
        return fullNotePageFixture(q as NotePageRequest, source, identity(), {
          chunk: pageChunk,
          canonicalPadding,
        });
      }

      record('note.get');
      reads++;
      return { ...note, content: source, contentLength: source.length, rev };
    },
    'note.update': (params) => {
      record('note.update');
      const p = params as { expectedVersion: number; content: string };
      if (p.expectedVersion !== rev) throw new Error('Conflict');
      source = p.content;
      writes++;
      return { ...note, content: source, contentLength: source.length, rev: ++rev };
    },
  };
  // A mocked request may run synchronously inside a mounting effect. Keep fixture
  // counters out of that caller's dependency tracking, like the real IPC boundary.
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only scripted wire boundary.
  installMockElectronBridge(
    Object.fromEntries(
      Object.entries(handlers).map(([method, handler]) => [
        method,
        (params: unknown) => untrack(() => handler(params)),
      ]),
    ),
  );
  const api = window.electronAPI!;
  const previousVersions = api.versions;
  // Only clipboard-positive fixtures model a native-capable preload. Publication
  // remains scripted IPC recording, never an operating-system clipboard claim.
  const clipboardVersions = { ...previousVersions, electron: '42.0.0-clipboard-fixture' };
  if (nativeClipboard) api.versions = clipboardVersions;
  onDestroy(() => {
    if (window.electronAPI === api && api.versions === clipboardVersions)
      api.versions = previousVersions;
  });
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only synchronous mock notification registration.
  const originalOn = api.on.bind(api);
  api.on = ((channel: string, callback: (payload: unknown) => void) => {
    const id = originalOn(channel, callback);
    if (channel === 'backend:notification') listeners.set(String(id), callback);
    return id;
  }) as typeof api.on;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only synchronous mock notification cleanup.
  const originalOff = api.offById.bind(api);
  api.offById = ((channel: string, id: string) => {
    listeners.delete(id);
    return originalOff(channel, id);
  }) as typeof api.offById;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only IPC transport fixture; no operating-system publication is claimed.
  const originalInvoke = api.invoke.bind(api);
  const token = '00000000-0000-4000-8000-000000000001';
  let clipSequence = 0;
  api.invoke = (async (channel: string, payload: unknown) => {
    const p = payload as {
      id: string;
      text: string;
      length: number;
      expiresAt: number;
      token: string;
      sequence: number;
      utf8Bytes: number;
    };
    const c = IPC_CHANNELS.SYSTEM;
    if (channel === c.SOURCE_CLIPBOARD_BEGIN) {
      clipboardSource = '';
      clipSequence = 0;
      return { success: true, data: { ...p, token } };
    }
    if (channel === c.SOURCE_CLIPBOARD_WRITE) {
      clipboardSource += p.text;
      return {
        success: true,
        data: {
          id: p.id,
          token,
          sequence: ++clipSequence,
          length: clipboardSource.length,
          utf8Bytes: new TextEncoder().encode(clipboardSource).length,
        },
      };
    }
    if (channel === c.SOURCE_CLIPBOARD_COMMIT) {
      copied = clipboardSource === source;
      copyCount++;
      return {
        success: true,
        data: {
          ...p,
          published: true,
          sha256: '0'.repeat(64),
          admittedBytes: 2 * p.utf8Bytes + 8 * p.length,
        },
      };
    }
    if (channel === c.SOURCE_CLIPBOARD_ABORT) return { success: true };
    return originalInvoke(channel, payload);
  }) as typeof api.invoke;
  // Script the renderer router as well as preload; this is not native clipboard proof.
  const restoreClipboard = [
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_BEGIN,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_WRITE,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_COMMIT,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_ABORT,
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Test-only router forwards to the scripted preload fixture, without fetching domain data.
  ].map((channel) => overrideMockIpcHandler(channel, (payload) => api.invoke(channel, payload)));
  onDestroy(() => restoreClipboard.reverse().forEach((restore) => restore()));
  const dispose = startRootStoreLifecycle(store, {
    startSagas: (s) => startWorkspaceNotesSagaFixture(s),
  });
  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: 'Complete note',
      path: '/tmp/note-tab-ct',
    } as Workspace),
  );
  store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: [note] }));
  const header = createPanelHeaderContext();
  onDestroy(dispose);
</script>

<div class="h-[600px] flex flex-col" data-testid="note-pane">
  <button
    onclick={() =>
      store.dispatch(
        setWorkspaceEntity({
          id: WorkspaceId(workspaceId),
          title: 'Refreshed note workspace',
          path: '/tmp/note-tab-ct',
        } as Workspace),
      )}>Refresh workspace metadata</button
  >
  <Menu.Root
    ><Menu.Trigger>Commands</Menu.Trigger><Menu.Content
      >{#if header.actions.current}{@render header.actions.current.actions?.()}{/if}</Menu.Content
    ></Menu.Root
  >
  <NoteTabType
    tab={{ id: 'note-tab', type: 'note', title: 'Complete note', noteId, closable: true }}
    {workspaceId}
    isActive
    isPanelFocused
  />
  <output data-testid="wire"
    >{JSON.stringify({
      methods,
      viewFailure,
      pageError: $pageSession?.error,
      generation: $pageSession?.generation,
      windows: Object.fromEntries(
        Object.entries($pageSession?.windows ?? {}).map(([id, w]) => [
          id,
          {
            error: w.error,
            loaded: !!w.value,
            loading: w.loading,
            range: w.value?.range,
            growth: w.growth,
            request: w.request,
            scope: w.value?.scope,
            sourceRevision: w.value?.sourceRevision,
            snapshotId: w.value?.snapshotId,
            resourceOwner: w.resourceOwner,
          },
        ]),
      ),
      reads,
      writes,
      pageReads,
      maxPageAt,
      copied,
      copyCount,
      length: source.length,
      end: source.slice(-30),
    })}</output
  >
</div>
