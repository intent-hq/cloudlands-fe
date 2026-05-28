<script lang="ts">
  /**
   * AgentAttributionBadge
   *
   * A compact badge that shows which agent made a change.
   * Clicking opens the agent drawer and scrolls to the relevant turn.
   */
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import type { AgentAttribution } from '$features/file-tracking/types';
  import { dispatchWindowEvent } from '$lib/utils/window-events';
  import { openAgentTabRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';

  const logger = createLogger('AgentAttributionBadge');

  interface Props {
    attribution: AgentAttribution;
    /** Size variant */
    size?: 'xs' | 'sm' | 'md';
    /** Show only the avatar without name */
    compact?: boolean;
    /** Optional class name */
    class?: string;
  }

  let { attribution, size = 'sm', compact = false, class: className = '' }: Props = $props();

  // Avatar size based on badge size
  const avatarSize = $derived(size === 'xs' ? 12 : size === 'sm' ? 14 : 16);

  // Handle click - open agent drawer and scroll to turn
  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    logger.info('[AgentAttributionBadge] Clicked, navigating to agent turn', {
      agentId: attribution.agentId,
      turnNumber: attribution.turnNumber,
    });

    // Get source panel ID for same-panel navigation
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;

    // First, open the agent in panel
    const wsId = selectActiveWorkspaceId.select(getReduxStore().getState());
    if (wsId) {
      getReduxStore().dispatch(
        openAgentTabRequested(wsId, {
          agentId: attribution.agentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }

    // Then scroll to the specific turn after a delay to let drawer open
    setTimeout(() => {
      dispatchWindowEvent('agent:scroll-to-turn', {
        agentId: attribution.agentId,
        turnNumber: attribution.turnNumber,
        sessionId: attribution.sessionId,
      });
    }, 300);
  }

  // Truncate agent name for display
  const displayName = $derived.by(() => {
    const name = attribution.agentName || 'Agent';
    if (name.length > 20) {
      return name.slice(0, 18) + '…';
    }
    return name;
  });
</script>

<button
  type="button"
  class="inline-flex items-center gap-1.5 rounded-md transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring
    {size === 'xs'
    ? 'px-1 py-0.5 text-ui'
    : size === 'sm'
      ? 'px-1.5 py-0.5 text-xs'
      : 'px-2 py-1 text-sm'}
    {className}"
  onclick={handleClick}
  title="View agent turn #{attribution.turnNumber}"
>
  {#if !compact}
    <span class="text-subtle">edited by</span>
  {/if}
  <AuggieAvatar agentId={attribution.agentId} size={avatarSize} />
  {#if !compact}
    <span class="text-foreground truncate max-w-[150px] font-medium">
      {displayName}
    </span>
  {/if}
</button>
