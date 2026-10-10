<script lang="ts">
  import { startWorkspaceNotesSagaFixture } from '../../../../../test/fixtures/workspace-notes-saga-fixture';
  import { NoteWindowView } from '$features/notes/virtualized/note-window-view';
  import { selectNotePageSession } from '$store/renderer/slices/note-pages/note-pages-selectors';
  import { onDestroy, untrack } from 'svelte';
  import { Toast, toast } from '$lib/components/ui/toast';
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
  import type { NoteDeleteReceipt, NoteDeleteScheduleRequest } from '$lib/client/note-delete';
  import type { NotePageRequest } from '$lib/client/note-pages';
  import { fullNotePageFixture } from './full-note-page-fixture';
  import NoteTabType from '../../NoteTabType.svelte';
  import NotesPanel from '$lib/components/workspace/sidebar/NotesPanel.svelte';
  let {
    initialContent = '# Complete note',
    paging = false,
    failPages = false,
    pageChunk = 1024,
    canonicalPadding = 0,
    nativeClipboard = false,
    deleteUndo = false,
    deleteMode = 'supported',
    sidebarDelete = false,
    nativeDelete = false,
  } = $props<{
    initialContent?: string;
    paging?: boolean;
    failPages?: boolean;
    pageChunk?: number;
    canonicalPadding?: number;
    nativeClipboard?: boolean;
    deleteUndo?: boolean;
    sidebarDelete?: boolean;
    nativeDelete?: boolean;
    deleteMode?: 'supported' | 'unsupported' | 'lost-ack' | 'rejected';
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
  let deleted = $state(false);
  let restored = $state<Record<string, unknown> | null>(null);
  let deleteRequest = $state<unknown>(null);
  let graceOperation = $state<NoteDeleteReceipt | null>(null);
  let graceSubscriptions = $state<
    { workspaceId: string; handle: string; subscriptionId: string }[]
  >([]);
  let graceUnsubscriptions = $state<string[]>([]);
  let graceGenericSubscriptions = $state(0);
  const activeGraceHandles = new Set<string>();
  const graceEpoch = '22d5f71d-8a89-42da-b6c7-d4b27a3a1748';
  const graceTick = () => Math.floor(performance.now());
  let graceSequence = 0;
  const graceSnapshot = () => ({
    epoch: graceEpoch,
    serverTickMs: graceTick(),
    sequence: graceSequence,
  });

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
            ? {
                notePagingRead: 1,
                notePagingBackendId: scope.backendId,
                ...(deleteUndo && deleteMode !== 'unsupported' ? { noteDeleteGrace: 1 } : {}),
              }
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
    'note.deleteStatus': (params) => {
      record('note.deleteStatus');
      if (!deleteUndo || deleteMode === 'unsupported') throw new Error('Grace unavailable');
      const p = params as { workspaceId: string; noteId?: string; operationKey?: unknown };
      if (p.workspaceId !== workspaceId || (p.noteId && p.noteId !== noteId))
        throw new Error('Status scope mismatch');
      const operation = graceOperation;
      const pending =
        operation && operation.state === 'PENDING'
          ? [
              {
                operationKey: operation.operationKey,
                noteId,
                noteInstanceId: 'i',
                state: operation.state,
                sequence: operation.sequence,
                deadlineTickMs: operation.deadlineTickMs,
                deleteAt: operation.deleteAt,
                canCancel: true,
              },
            ]
          : [];
      return {
        ...graceSnapshot(),
        current:
          p.noteId && !deleted
            ? { noteInstanceId: 'i', revision: rev, sourceRevision: 'r' + rev }
            : null,
        pending,
        operation: p.operationKey
          ? (operation ?? { operationKey: p.operationKey, state: 'UNKNOWN', reason: 'unavailable' })
          : null,
      };
    },
    'note.deleteSchedule': (params) => {
      record('note.deleteSchedule');
      if (!deleteUndo || deleteMode === 'unsupported') throw new Error('Grace unavailable');
      const p = params as NoteDeleteScheduleRequest;
      if (
        p.workspaceId !== workspaceId ||
        p.noteId !== noteId ||
        p.expectedVersion !== rev ||
        p.sourceRevision !== 'r' + rev ||
        p.noteInstanceId !== 'i' ||
        p.operationKey.epoch !== graceEpoch
      )
        throw new Error('Schedule identity/revision mismatch');
      if (deleteMode === 'rejected') throw new Error('Controlled schedule rejection');
      deleteRequest = p;
      graceOperation = {
        operationKey: p.operationKey,
        workspaceId,
        noteId,
        noteInstanceId: 'i',
        state: 'PENDING',
        sequence: ++graceSequence,
        deadlineTickMs: graceTick() + 15000,
        deleteAt: new Date(Date.now() + 15000).toISOString(),
        expiresTickMs: null,
        reason: null,
      };
      if (deleteMode === 'lost-ack') throw new Error('Controlled lost schedule acknowledgement');
      return { ...graceSnapshot(), operation: graceOperation };
    },
    'note.deleteCancel': (params) => {
      record('note.deleteCancel');
      const p = params as { workspaceId: string; noteId: string; operationKey: unknown };
      if (
        !graceOperation ||
        graceOperation.state !== 'PENDING' ||
        p.workspaceId !== workspaceId ||
        p.noteId !== noteId ||
        JSON.stringify(p.operationKey) !== JSON.stringify(graceOperation.operationKey)
      )
        throw new Error('Cancel identity mismatch');
      graceOperation = {
        ...graceOperation,
        state: 'CANCELLED',
        sequence: ++graceSequence,
        expiresTickMs: graceTick() + 300000,
        reason: 'cancelled',
      };
      return { ...graceSnapshot(), operation: graceOperation };
    },
    'note.delete': () => {
      record('note.delete');
      throw new Error('Immediate deletion is forbidden in this fixture');
    },
    'note.create': () => {
      record('note.create');
      throw new Error('Recreation is forbidden in this fixture');
    },
    'note.list': () => ({
      notes: restored
        ? [{ ...note, ...restored, id: 'restored-note', contentLength: undefined }]
        : deleted
          ? []
          : [note],
    }),
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
  // Explicit clipboard/Delete fixtures model a native-capable preload. These
  // remain scripted IPC controls, never operating-system acceptance.
  const clipboardVersions = { ...previousVersions, electron: '42.0.0-clipboard-fixture' };
  const operationVersions =
    deleteUndo && nativeDelete
      ? { ...previousVersions, electron: '42.0.0-note-delete-fixture' }
      : clipboardVersions;
  if (nativeClipboard || (deleteUndo && nativeDelete)) api.versions = operationVersions;
  onDestroy(() => {
    if (window.electronAPI === api && api.versions === operationVersions)
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
    if (deleteUndo && channel === IPC_CHANNELS.BACKEND.NODE_CAPABILITIES) {
      if (payload !== undefined) throw new Error('Capability observation takes no request body');
      record('backend.nodeCapabilities');
      return {
        ok: true,
        result: {
          server: { capabilities: deleteMode === 'unsupported' ? {} : { noteDeleteGrace: 1 } },
        },
      };
    }
    if (deleteUndo && channel === IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.SUBSCRIBE) {
      if (payload !== workspaceId) throw new Error('Delete subscription workspace mismatch');
      return untrack(() => {
        const index = graceSubscriptions.length + 1;
        const binding = {
          workspaceId,
          handle: `grace-handle-${index}`,
          subscriptionId: `grace-sub-${index}`,
        };
        activeGraceHandles.add(binding.handle);
        graceSubscriptions.push(binding);
        return {
          ok: true,
          result: { handle: binding.handle, subscriptionId: binding.subscriptionId },
        };
      });
    }
    if (deleteUndo && channel === IPC_CHANNELS.BACKEND.NOTE_DELETE_SUBSCRIPTION.UNSUBSCRIBE) {
      if (typeof payload !== 'string' || !activeGraceHandles.delete(payload))
        throw new Error('Delete cleanup requires its exact active opaque handle');
      untrack(() => graceUnsubscriptions.push(payload));
      return { ok: true, result: undefined };
    }
    if (
      deleteUndo &&
      (channel === IPC_CHANNELS.BACKEND.SUBSCRIBE || channel === IPC_CHANNELS.BACKEND.UNSUBSCRIBE)
    ) {
      untrack(() => graceGenericSubscriptions++);
      throw new Error('Delete subscription cannot use generic IPC fallback');
    }
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
  onDestroy(() => {
    if (deleteUndo) toast.dismiss();
  });
</script>

{#if deleteUndo}<Toast /><button onclick={dispose}>Stop note fixture lifecycle</button>{/if}
{#if sidebarDelete}<div data-testid="delete-sidebar">
    <NotesPanel {workspaceId} notes={[note]} />
  </div>{/if}

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
      >{#if header.actions.current}{@render header.actions.current.actions?.()}{#if deleteUndo}{@render header.actions.current.destructive?.()}{/if}{/if}</Menu.Content
    ></Menu.Root
  >
  <NoteTabType
    tab={{ id: 'note-tab', type: 'note', title: 'Complete note', noteId, closable: true }}
    {workspaceId}
    isActive
    isPanelFocused
  />
  <output hidden data-testid="wire"
    >{JSON.stringify({
      methods,
      deleted,
      deleteRequest,
      graceOperation,
      graceSubscriptions,
      graceUnsubscriptions,
      graceGenericSubscriptions,
      original: { ...note, content: source, rev },
      restored,
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
