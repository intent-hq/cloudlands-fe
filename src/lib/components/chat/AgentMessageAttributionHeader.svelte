<script lang="ts">
  /**
   * AgentMessageAttributionHeader
   *
   * Compact sender attribution for agent-to-agent messages: Auggie avatar +
   * sender agent name + "sent a message". Clicking opens the sender agent's
   * tab (same click-through pattern as AgentAttributionBadge).
   */
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import type { AgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    attribution: AgentMessageAttribution;
    /** Optional class name */
    class?: string;
  }

  let { attribution, class: className = '' }: Props = $props();

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Get source panel ID for same-panel navigation
    const panelElement = (e.currentTarget as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;

    const wsId = selectActiveWorkspaceId.select(appStore.state);
    if (wsId) {
      appStore.dispatch(
        openAgentTabRequested(wsId, {
          agentId: attribution.fromAgentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }
</script>

<button
  type="button"
  class="flex items-center gap-1.5 rounded-md text-xs cursor-pointer transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring {className}"
  onclick={handleClick}
  ondblclick={(e) => e.stopPropagation()}
  title={m.chat_msgAttribution_openAgent_title({ name: attribution.displayName })}
  data-testid="agent-message-attribution"
>
  <AuggieAvatar agentId={attribution.fromAgentId} size={14} />
  <span class="text-foreground truncate max-w-[150px] font-medium">
    {attribution.displayName}
  </span>
  <span class="text-subtle">{m.chat_msgAttribution_sentMessage_after()}</span>
</button>
