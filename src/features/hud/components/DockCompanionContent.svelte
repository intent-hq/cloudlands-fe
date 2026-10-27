<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { DockPointerRect } from '$shared/dock-layout';
  import type { DockWorkspaceView } from '$store/renderer/slices/hud/hud-selectors';
  import DockOverview from './DockOverview.svelte';
  import DockConversationSurface from './DockConversationSurface.svelte';

  let {
    workspaces,
    pending,
    expanded,
    reveal,
    floating,
    floatingUp,
    conversation,
    conversationWorkspaceId,
    focusRequest,
    onOpen,
    onFeedback,
    onRegionsChange,
    onPopupStateChange,
  }: {
    workspaces: DockWorkspaceView[];
    pending: boolean;
    expanded: boolean;
    reveal: number;
    floating: boolean;
    floatingUp: boolean;
    conversation?: Snippet;
    conversationWorkspaceId?: string | null;
    focusRequest: number;
    onOpen: (id: string) => void;
    onFeedback: (id: string, title: string) => void;
    onRegionsChange: (regions: DockPointerRect[]) => void;
    onPopupStateChange: (open: boolean) => void;
  } = $props();
  const progress = $derived(Math.pow(reveal, 4));
</script>

<div
  class="overview-frame"
  class:floating
  class:floating-up={floatingUp}
  class:conversation-open={!!conversationWorkspaceId && !!conversation}
  inert={!expanded || reveal === 0}
  aria-hidden={!expanded || reveal === 0}
  style:opacity={progress}
  style:transform={`translateY(${(floatingUp ? 4 : -4) * (1 - progress)}px)`}
>
  {#if conversationWorkspaceId && conversation}
    <DockConversationSurface
      workspaceId={conversationWorkspaceId}
      {focusRequest}
      active={expanded && reveal === 1}
      {onRegionsChange}
      {onPopupStateChange}
    >
      {@render conversation()}
    </DockConversationSurface>
  {:else}
    <DockOverview {workspaces} {pending} {onOpen} {onFeedback} />
  {/if}
</div>

<style>
  .overview-frame {
    position: absolute;
    top: var(--header-height);
    bottom: 0;
    left: 0;
    right: 0;
    padding: 8px 12px 12px;
  }
  .floating-up {
    top: 0;
    bottom: var(--header-height);
    padding-block: 12px 8px;
  }
  .conversation-open {
    padding: 0;
  }
</style>
