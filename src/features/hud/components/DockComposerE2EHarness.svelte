<script lang="ts">
  import { onMount } from 'svelte';
  import '$lib/styles/dock-tokens.css';
  import { IPC_CHANNELS } from '$shared/ipc-registry';
  import { store } from '$store/renderer/store';
  import { closeDockConversationRequested, openDockConversationRequested } from '$store/renderer/slices/dock-conversation/dock-conversation-slice';
  import DockConversation from './DockConversation.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';
  import {
    setupConversationWire,
    conversationWireWorkspace,
    type ConversationWireCall,
  } from './dock-conversation-wire.preview-fixtures';
  import { installSyntheticNative } from './dock-composer-e2e.preview-fixtures';

  /**
   * Walkthrough harness: production dock conversation, controller, sagas, editor
   * and send path. Only the daemon wire and the native helper are synthetic, and
   * tests drive them through `window.__dockComposerE2E`.
   */
  let { width = 420, height = 600 }: { width?: number; height?: number } = $props();
  let ready = $state(false);
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
  <!-- i18n-ignore (synthetic walkthrough caption) -->
  <p class="caption" data-testid="composer-e2e-caption" aria-live="off">{caption}</p>
</div>

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
