<script lang="ts">
  import { onDestroy } from 'svelte';
  import DockRail from '../DockRail.svelte';
  import { adaptiveDockFixture } from '../dock-rail.preview-fixtures';
  import { createDockPointerRegionController } from '$features/hud/utils/dock-pointer-routing';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import { WINDOW_CHANNELS } from '$shared/ipc/channels';
  import type { DockPlacementCommand } from '$shared/dock-placement';
  import type { DockPointerRect } from '$shared/dock-layout';
  import { dockIntro } from '$features/hud/intro/dock-intro.svelte';

  let {
    liveMode = '',
    intro = false,
    overview = false,
    focusRequest = 0,
    closeRequest = 0,
    recordingLive = false,
  }: {
    liveMode?: string;
    intro?: boolean;
    overview?: boolean;
    focusRequest?: number;
    /** The open shortcut again while the dock has the keyboard (the page passes the store's count). */
    closeRequest?: number;
    recordingLive?: boolean;
  } = $props();
  let placement = $state(adaptiveDockFixture('notch'));
  // svelte-ignore state_referenced_locally
  let workspaceId = $state<string | null>(overview ? null : 'synthetic-workspace');
  let draft = $state('Keep this draft');
  let commands = $state<DockPlacementCommand[]>([]);
  let regions = $state<DockPointerRect[]>([]);
  let menuOpen = $state(false);
  let finishMenu: (() => void) | undefined;
  let emitPresence: ((value: unknown) => void) | undefined;
  let protectedEscapes = $state(0);
  let stops = $state(0);
  const recordingStartedAt = Date.now();
  const recording = $derived(
    recordingLive
      ? {
          workspaceId: 'synthetic-workspace',
          agentId: 'synthetic-agent',
          clipId: 'synthetic-recording',
          startedAt: recordingStartedAt,
          pausedAt: null,
          pausedMs: 0,
        }
      : null,
  );
  const restore = overrideMockIpcHandler(WINDOW_CHANNELS.SHOW_DOCK_MENU, () => {
    menuOpen = true;
    return new Promise((resolve) => {
      finishMenu = () => {
        menuOpen = false;
        resolve({ shown: true });
      };
    });
  });
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synthetic pointer bridge for browser proof
  const pointerController = createDockPointerRegionController({
    invoke: async (_channel, value) => {
      if (value && typeof value === 'object' && 'regions' in value)
        regions = (value as { regions: DockPointerRect[] }).regions;
    },
    on: (_channel, callback) => {
      emitPresence = callback;
      return 'synthetic-presence';
    },
    offById: () => {},
  });
  $effect(() => {
    dockIntro.hold = intro;
    dockIntro.open = intro;
  });
  function command(value: DockPlacementCommand) {
    commands = [...commands, value];
    if (value.action !== 'resize') return;
    const width = value.width,
      height = value.height;
    if (placement.surface.width === width && placement.surface.height === height) return;
    placement = {
      ...placement,
      revision: placement.revision + 1,
      surface: { x: (640 - width) / 2, y: 0, width, height },
    };
  }
  function key(event: KeyboardEvent) {
    if (liveMode && event.key === 'Escape') {
      protectedEscapes += 1;
      event.preventDefault();
    }
  }
  onDestroy(() => {
    restore();
    dockIntro.hold = false;
    dockIntro.open = false;
  });
</script>

<svelte:window onkeydowncapture={key} />
<div
  data-testid="dismiss-proof"
  data-commands={JSON.stringify(commands)}
  data-regions={JSON.stringify(regions)}
  data-workspace={workspaceId ?? ''}
  data-draft={draft}
  data-protected-escapes={protectedEscapes}
  data-stops={stops}
>
  <DockRail
    workspaces={[]}
    {placement}
    {pointerController}
    {focusRequest}
    {closeRequest}
    {recording}
    onStopRecording={() => (stops += 1)}
    onPlacementCommand={command}
    conversationWorkspaceId={workspaceId}
    onCloseConversation={() => (workspaceId = null)}
    inputLive={!!liveMode || recordingLive}
    onOpenWorkspace={() => {}}
    onOpenAssistant={() => {}}
    staticData
  >
    {#snippet conversation()}
      <label
        >Draft<textarea aria-label="Draft" data-dock-conversation-composer bind:value={draft}
        ></textarea></label
      >
    {/snippet}
  </DockRail>
  <button data-testid="outside" style="position:fixed;left:750px;top:630px">Outside the dock</button
  >
  <button
    data-testid="native-outside"
    style="position:fixed;left:750px;top:670px"
    onclick={() => emitPresence?.({ inside: false, x: 850, y: 650, revision: placement.revision })}
    >Native outside</button
  >
  {#if menuOpen}<button
      data-testid="finish-menu"
      style="position:fixed;left:750px;top:590px"
      onclick={() => finishMenu?.()}>Close synthetic native menu</button
    >{/if}
</div>
