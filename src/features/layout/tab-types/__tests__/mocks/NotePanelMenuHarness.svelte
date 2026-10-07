<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { startWorkspaceNotesSagaFixture } from '../../../../../test/fixtures/workspace-notes-saga-fixture';
  import { selectNotePageSession } from '$store/renderer/slices/note-pages/note-pages-selectors';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import type { NotePageRequest } from '$lib/client/note-pages';
  import { fullNotePageFixture } from './full-note-page-fixture';
  import { ContentType, NoteVisibility, WorkspaceStatus, type Note } from '$shared/types';
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
  import {
    setWorkspaceEntity,
    removeWorkspaceEntity,
  } from '$store/renderer/slices/workspace/workspace-slice';
  import { installMockElectronBridge } from '../../../../../test/ct-mock-electron-bridge';

  const workspaceId = 'note-panel-menu-ct';
  const note: Note = {
    id: NoteId('menu-note'),
    workspaceId: WorkspaceId(workspaceId),
    title: 'Menu acceptance note',
    content: '# Menu acceptance\n\nCopy the complete note.',
    contentLength: '# Menu acceptance\n\nCopy the complete note.'.length,
    rev: 4,
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Private,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
  };
  const previousBridge = window.electronAPI;
  const pageSession = selectNotePageSession(workspaceId, note.id);
  const listeners = new Map<string, (payload: unknown) => void>();
  const scope = { backendId: 'note-menu-ct', workspaceId, noteId: note.id, noteInstanceId: 'i' };
  const identity = {
    scope,
    sourceRevision: 'r4',
    snapshotId: 's4',
    expiresAt: '2099-01-01T00:00:00Z',
  };
  let committedText = $state<string | null>(null),
    commits = $state(0),
    stagedText = $state('');
  let sequence = 0;
  const token = '00000000-0000-4000-8000-000000000001';
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT-only local bridge setup; no domain data is fetched.
  installMockElectronBridge({
    'client.hello': () => ({
      server: { capabilities: { notePagingRead: 1, notePagingBackendId: scope.backendId } },
    }),
    'note.subscribe': () => {
      setTimeout(() => {
        for (const callback of listeners.values())
          callback({
            method: 'subscription.push',
            params: {
              subscriptionId: 'note-menu-sub',
              seq: 0,
              kind: 'snapshot',
              snapshot: {
                ...identity,
                kind: 'notePageState',
                stateGeneration: '4',
                attributionGeneration: '1',
                attributionState: 'ready',
                commentRevision: '1',
                deleted: false,
                invalidation: 'all',
              },
            },
          });
      }, 0);
      return { subscriptionId: 'note-menu-sub' };
    },
    'note.unsubscribe': () => ({}),
    'note.get': (params) => {
      const page = (params as { page?: NotePageRequest }).page;
      return page ? fullNotePageFixture(page, note.content, identity) : { note };
    },
    'comment.list': () => ({ threads: [] }),
    'note.lineAttribution.load': () => null,
    'principal.me': () => ({ id: 'note-menu-owner' }),
    'note.presence.subscribe': () => ({ subscriptionId: 'note-menu-presence' }),
    'note.presence.unsubscribe': () => ({ ok: true }),
    'note.presence.update': () => ({ ok: true }),
  });
  const api = window.electronAPI!;
  const previousVersions = api.versions;
  // This fixture records native protocol publication, never the OS clipboard.
  const clipboardVersions = { ...previousVersions, electron: '42.0.0-clipboard-fixture' };
  api.versions = clipboardVersions;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT notification ownership only.
  const originalOn = api.on.bind(api);
  api.on = ((channel: string, callback: (payload: unknown) => void) => {
    const id = originalOn(channel, callback);
    if (channel === 'backend:notification') listeners.set(String(id), callback);
    return id;
  }) as typeof api.on;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT notification ownership only.
  const originalOff = api.offById.bind(api);
  api.offById = ((channel: string, id: string) => {
    listeners.delete(id);
    return originalOff(channel, id);
  }) as typeof api.offById;
  // eslint-disable-next-line intent/no-component-async-data-fetch -- CT scripted native transport only.
  const originalInvoke = api.invoke.bind(api);
  api.invoke = (async (channel: string, payload: unknown) =>
    untrack(() => {
      const p = payload as { id: string; text: string; length: number; utf8Bytes: number };
      const c = IPC_CHANNELS.SYSTEM;
      if (channel === c.SOURCE_CLIPBOARD_BEGIN) {
        stagedText = '';
        sequence = 0;
        return { success: true, data: { ...p, token } };
      }
      if (channel === c.SOURCE_CLIPBOARD_WRITE) {
        stagedText += p.text;
        return {
          success: true,
          data: {
            id: p.id,
            token,
            sequence: ++sequence,
            length: stagedText.length,
            utf8Bytes: new TextEncoder().encode(stagedText).length,
          },
        };
      }
      if (channel === c.SOURCE_CLIPBOARD_COMMIT) {
        committedText = stagedText;
        commits++;
        stagedText = '';
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
      if (channel === c.SOURCE_CLIPBOARD_ABORT) {
        stagedText = '';
        return { success: true };
      }
      return originalInvoke(channel, payload);
    })) as typeof api.invoke;
  const restoreClipboard = [
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_BEGIN,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_WRITE,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_COMMIT,
    IPC_CHANNELS.SYSTEM.SOURCE_CLIPBOARD_ABORT,
    // eslint-disable-next-line intent/no-component-async-data-fetch -- CT router delegates to scripted preload.
  ].map((channel) => overrideMockIpcHandler(channel, (payload) => api.invoke(channel, payload)));
  const dispose = startRootStoreLifecycle(store, {
    startSagas: (s) => startWorkspaceNotesSagaFixture(s),
  });
  store.dispatch(
    setWorkspaceEntity({
      id: WorkspaceId(workspaceId),
      title: 'Note menu workspace',
      branch: '',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      status: WorkspaceStatus.Active,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }),
  );
  store.dispatch(loadWorkspaceNotesSucceeded([workspaceId], { [workspaceId]: [note] }));
  const tab: PanelTab = {
    id: 'note-menu-tab',
    type: 'note',
    title: note.title,
    noteId: note.id,
    closable: true,
  };
  const admittedWindow = $derived($pageSession?.windows[tab.id]);
  const header = createPanelHeaderContext();
  onDestroy(() => {
    store.dispatch(clearWorkspaceNotesForWorkspaces([workspaceId]));
    store.dispatch(removeWorkspaceEntity(workspaceId));
    dispose();
    restoreClipboard.reverse().forEach((restore) => restore());
    listeners.clear();
    if (window.electronAPI === api && api.versions === clipboardVersions)
      api.versions = previousVersions;
    if (window.electronAPI === api) window.electronAPI = previousBridge;
  });
</script>

<!-- The real note registers its production snippets against an editable workspace. -->
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
  <output data-testid="note-menu-wire"
    >{JSON.stringify({
      status: $pageSession?.status,
      window: {
        tabId: tab.id,
        loading: admittedWindow?.loading,
        scope: admittedWindow?.value?.scope,
        sourceRevision: admittedWindow?.value?.sourceRevision,
        snapshotId: admittedWindow?.value?.snapshotId,
        range: admittedWindow?.value?.range,
        text: admittedWindow?.value?.text,
      },
      committedText,
      commits,
      stagedText,
    })}</output
  >
</section>
