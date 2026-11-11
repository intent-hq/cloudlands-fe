<script context="module" lang="ts">
  import type { DockForegroundObservation } from '$shared/dock-context-links';
</script>

<script lang="ts">
  import { choosePendingDockShortcut } from '$features/hud/dock-navigation';
  import {
    dockContextLinkRequested,
    dockContextUnlinkRequested,
    dockContextFollowed,
    dockContextDismissed,
    dockContextAutoDecisionRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { selectDockLinkedContext } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { getPrincipalActionContext } from '$store/renderer/slices/principal/principal-context';
  import { scriptCommandLabel } from '$features/scripts/types';
  import {
    scriptSnapshotReceived,
    updateRuntimeState,
  } from '$store/renderer/slices/scripts/scripts-slice';
  import { daemonEventsSubscribed } from '$store/renderer/slices/workspace-events/workspace-events-slice';
  import { getPrincipalConnectionContext } from '$store/renderer/slices/principal/principal-context';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import { setWorkspaceHasLoaded } from '$store/renderer/slices/workspace/workspace-slice';
  import { dockShortcutChanged } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import { selectDockConversationWorkspaceId } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { dockRailPreview } from './dock-rail.preview-fixtures';
  import { selectDockShortcut } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import { selectDockShortcutWorkspaces } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';
  import {
    selectDockCloseRequest,
    selectDockFocusRequest,
  } from '$store/renderer/slices/hud/hud-selectors';
  import { selectDockSideDefaultWorkspaceId } from '$store/renderer/slices/dock-conversation/dock-side-default';
  import { WorkspaceStatus } from '$shared/types';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { connectionStatusChanged } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { onMount } from 'svelte';
  import '$lib/styles/dock-tokens.css';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { store } from '$store/renderer/store';
  import {
    closeDockConversationRequested,
    openDockConversationRequested,
  } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import DockConversation from './DockConversation.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';
  import {
    setupConversationWire,
    conversationWireWorkspace,
    type ConversationWireCall,
  } from './dock-conversation-wire.preview-fixtures';
  import { installSyntheticNative } from './dock-composer-e2e.preview-fixtures';
  import DockRailPreview from './dock-rail.preview.svelte';
  import type { DockRailPreviewProps } from './dock-rail.preview-fixtures';

  /**
   * Walkthrough harness: production dock conversation, controller, sagas, editor
   * and send path. Only the daemon wire and the native helper are synthetic, and
   * tests drive them through `window.__dockComposerE2E`.
   */
  let {
    width = 420,
    height = 600,
    shell,
  }: {
    width?: number;
    height?: number;
    shell?: DockRailPreviewProps;
  } = $props();
  const shortcut$ = selectDockShortcut();
  const workspaces$ = selectDockShortcutWorkspaces();
  const closeRequest$ = selectDockCloseRequest();
  const sideDefaultWorkspaceId$ = selectDockSideDefaultWorkspaceId();
  const workspaceId$ = selectDockConversationWorkspaceId();
  const home = $derived(!!$shortcut$ && $shortcut$.destination === null && !$shortcut$.resolving);
  function openHome(id: string) {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous intent selection and store dispatch only
    if (!choosePendingDockShortcut(id)) store.dispatch(openDockConversationRequested(id));
  }
  function dismissHome() {
    if (home) store.dispatch(dockShortcutChanged(null));
  }
  let ready = $state(false);
  let request = $state(0);
  // Like the dock route: the store's focus request also reaches the shell.
  const storeFocusRequest$ = selectDockFocusRequest();
  let caption = $state('');

  onMount(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    const hadLight = root.classList.contains('light');
    root.classList.add('dark');
    root.classList.remove('light');
    const { native, uninstall } = installSyntheticNative();
    const calls: ConversationWireCall[] = [];
    const fixture = setupConversationWire((call) => calls.push(call));
    // The local sidecar places a native clip by host path; the wire fixture only
    // accepts bytes, so answer that one placement here (no file is read).
    const api = window.electronAPI!;
    const invoke = api.invoke;
    let clipPlacements = 0;
    let holdPlacements = false;
    const heldPlacements: Array<() => void> = [];
    api.invoke = (async (channel: string, payload?: unknown) => {
      const request = payload as { method?: string; params?: Record<string, unknown> } | undefined;
      if (
        channel === IPC_CHANNELS.BACKEND.REQUEST &&
        request?.method === 'file.placeAttachment' &&
        typeof request.params?.sourcePath === 'string'
      ) {
        const params = request.params;
        calls.push({ method: 'file.placeAttachment', params: structuredClone(params) });
        clipPlacements += 1;
        if (holdPlacements) await new Promise<void>((resolve) => heldPlacements.push(resolve));
        return {
          ok: true,
          result: {
            ok: true,
            attachmentId: `5c1d0000-0000-4000-8000-${String(clipPlacements).padStart(12, '0')}`,
            path: `.intent/attachments/${String(params.fileName)}`,
            fileName: String(params.fileName),
            size: 48_000,
            mimeType: String(params.mimeType ?? 'video/mp4'),
            uploadedAt: '2026-10-29T23:30:00.000Z',
          },
        };
      }
      return invoke(channel as never, payload as never);
    }) as typeof api.invoke;
    (window as unknown as Record<string, unknown>).__dockComposerE2E = {
      native,
      context(value: DockForegroundObservation) {
        fixture.emit(IPC_CHANNELS.DOCK_CONTEXT.CHANGED, value);
      },
      contextSnapshot: () => selectDockLinkedContext.select(store.state),
      contextScript(script: import('$features/scripts/types').ScriptListEntry) {
        store.dispatch(
          scriptSnapshotReceived(script.workspaceId, {
            ...script,
            command: scriptCommandLabel(script),
          }),
        );
      },
      contextRuntimeNoise(workspaceId: string, scriptId: string) {
        for (let index = 0; index < 100; index++)
          store.dispatch(
            updateRuntimeState(workspaceId, scriptId, {
              error: `synthetic-noise-${index}`,
              previouslyRunning: index % 2 === 0,
            }),
          );
      },
      contextRuntime(
        workspaceId: string,
        scriptId: string,
        partial: import('$features/scripts/types').ScriptRuntimeState,
      ) {
        store.dispatch(updateRuntimeState(workspaceId, scriptId, partial));
      },
      contextReady() {
        store.dispatch(
          setWorkspaceHasLoaded(
            true,
            store.state.connections.windowBackendId,
            getPrincipalActionContext(store.state),
          ),
        );
      },
      contextPrincipal(id: string) {
        const previous = store.state.principal;
        if (!previous.snapshot) return;
        store.dispatch(daemonEventsSubscribed());
        const context = getPrincipalConnectionContext(store.state);
        store.dispatch(principalContextChanged(context));
        const current = store.state.principal;
        if (!context) return;
        store.dispatch(
          principalReceived(
            {
              context,
              invalidation: current.invalidation,
              presentationVersion: current.presentationVersion,
            },
            { ...previous.snapshot, principal: { ...previous.snapshot.principal, id } },
          ),
        );
        store.dispatch(
          setWorkspaceHasLoaded(
            true,
            store.state.connections.windowBackendId,
            getPrincipalActionContext(store.state),
          ),
        );
      },
      contextAction(
        action: 'link' | 'unlink' | 'follow' | 'dismiss' | 'yes' | 'no',
        workspaceId?: string,
        basedOn?: string,
      ) {
        const version = basedOn ?? selectDockLinkedContext.select(store.state)?.contextVersion;
        if (!version) return;
        if (action === 'link' && workspaceId)
          store.dispatch(dockContextLinkRequested(version, workspaceId));
        else if (action === 'unlink') store.dispatch(dockContextUnlinkRequested(version));
        else if (action === 'follow') store.dispatch(dockContextFollowed(version));
        else if (action === 'dismiss') store.dispatch(dockContextDismissed(version));
        else if (action === 'yes' || action === 'no')
          store.dispatch(dockContextAutoDecisionRequested(version, action));
      },
      archiveWorkspace(id: string) {
        const workspace = selectDockShortcutWorkspaces
          .select(store.state)
          .find((row) => row.id === id);
        if (workspace)
          store.dispatch(setWorkspaceEntity({ ...workspace, status: WorkspaceStatus.Archived }));
      },
      seedChoices(count: number) {
        const base = selectDockShortcutWorkspaces.select(store.state)[0];
        if (!base) return;
        for (let index = 0; index < count; index++)
          store.dispatch(
            setWorkspaceEntity({
              ...base,
              id: `choice-${index}` as typeof base.id,
              title: `Synthetic workspace ${index} with a long project title`,
              branch: `branch-${index}`,
              status: WorkspaceStatus.Active,
            }),
          );
      },
      disconnect: () => store.dispatch(connectionStatusChanged('disconnected')),
      shortcut(context: import('$shared/dock-shortcuts').DockShortcutContext) {
        // A second press while the dock has the keyboard is a close request (decided by the dock saga).
        if (context.toggleClose !== true) request++;
        fixture.emit('window:focus-dock', context);
      },
      seedWorkspace(workspace: import('$shared/types').Workspace) {
        store.dispatch(setWorkspaceEntity(workspace));
      },
      holdPlacements(value: boolean) {
        holdPlacements = value;
        if (!value) for (const resolve of heldPlacements.splice(0)) resolve();
      },
      calls,
      fixture,
      store,
      close: () => store.dispatch(closeDockConversationRequested()),
      reopen: () => store.dispatch(openDockConversationRequested(conversationWireWorkspace)),
      setCaption: (text: string) => (caption = text),
    };
    store.dispatch(openDockConversationRequested(conversationWireWorkspace));
    ready = true;
    return () => {
      delete (window as unknown as Record<string, unknown>).__dockComposerE2E;
      fixture.dispose();
      uninstall();
      root.classList.toggle('dark', hadDark);
      root.classList.toggle('light', hadLight);
    };
  });
</script>

<div class="stage">
  {#if (shell || home) && ready}
    {@const props = shell ?? dockRailPreview.states.notch.props}
    <DockRailPreview
      {...props}
      focusRequest={request + $storeFocusRequest$}
      closeRequest={$closeRequest$}
      sideDefaultWorkspaceId={$sideDefaultWorkspaceId$}
      workspaces={$workspaces$.map((workspace) => ({ ...props.workspaces[0], workspace }))}
      conversationFixture
      conversationContent={conversation}
      conversationController={{
        workspaceId: home ? null : $workspaceId$,
        open: openHome,
        close: () => store.dispatch(closeDockConversationRequested()),
        dismiss: dismissHome,
      }}
    />
  {:else}
    <div
      data-testid="composer-e2e"
      style:width={`${width}px`}
      style:height={`${height}px`}
      data-dock-surface="notch"
      data-expanded
    >
      {#if ready}
        <DockConversationSurface workspaceId={conversationWireWorkspace} resizable={false}>
          <DockConversation onOpenWorkspace={() => {}} />
        </DockConversationSurface>
      {/if}
    </div>
  {/if}
  <!-- i18n-ignore (synthetic walkthrough caption) -->
  <p class="caption" data-testid="composer-e2e-caption" aria-live="off">{caption}</p>
</div>

{#snippet conversation()}
  <DockConversation onOpenWorkspace={() => {}} />
{/snippet}

<style>
  .stage {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    background: var(--color-background);
    min-height: 100vh;
    box-sizing: border-box;
  }
  .caption {
    margin: 0;
    width: 420px;
    font:
      500 13px/1.4 Inter,
      system-ui,
      sans-serif;
    color: var(--color-muted-foreground);
  }
</style>
