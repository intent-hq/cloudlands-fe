<script lang="ts">
  /**
   * AgentMessageAttributionHeader
   *
   * Subscription-style sender disclosure for agent-to-agent messages. Agent
   * navigation and disclosure are sibling actions so neither can activate the
   * other and the card never nests interactive controls.
   */
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import type { AgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import {
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  } from './subscription-disclosure';

  interface Props {
    attribution: AgentMessageAttribution;
    preview: string;
    expanded: boolean;
    controlsId: string;
    ontoggle: () => void;
    /** Optional class name */
    class?: string;
  }

  let {
    attribution,
    preview,
    expanded,
    controlsId,
    ontoggle,
    class: className = '',
  }: Props = $props();

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

  function handleToggle(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    ontoggle();
  }
</script>

<div
  class="{SUBSCRIPTION_DISCLOSURE_ROW_CLASS} font-normal text-muted-foreground {className}"
  data-testid="agent-message-disclosure-header"
>
  <button
    type="button"
    class="flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded border-none bg-transparent p-0 text-left font-[inherit] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    style="max-width: 40%;"
    onclick={handleClick}
    ondblclick={(event) => event.stopPropagation()}
    title={m.chat_msgAttribution_openAgent_title({ name: attribution.displayName })}
    data-testid="agent-message-attribution"
  >
    <span class="shrink-0" data-testid="agent-message-avatar-column">
      <AgentAvatar agentId={attribution.fromAgentId} size={20} />
    </span>
    <span class="min-w-0 truncate font-normal text-foreground" title={attribution.displayName}>
      {attribution.displayName}
    </span>
  </button>
  <button
    type="button"
    class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded border-none bg-transparent p-0 text-left font-[inherit] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    onclick={handleToggle}
    ondblclick={(event) => event.stopPropagation()}
    aria-expanded={expanded}
    aria-controls={controlsId}
    aria-label={preview
      ? `${m.chat_msgAttribution_sentMessage_after()}: ${preview}`
      : m.chat_msgAttribution_sentMessage_after()}
    data-testid="agent-message-disclosure-toggle"
  >
    <span class="shrink-0 whitespace-nowrap">{m.chat_msgAttribution_sentMessage_after()}</span>
    {#if preview}
      <span
        class="min-w-0 flex-1 truncate whitespace-nowrap text-ghost"
        title={preview}
        data-testid="agent-message-preview"
      >
        — {preview}
      </span>
    {:else}
      <span class="min-w-0 flex-1"></span>
    {/if}
    <span
      class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
      data-testid="agent-message-chevron-column"
    >
      <Fa
        icon={faChevronDown}
        class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded
          ? ''
          : 'rotate-90'}"
      />
    </span>
  </button>
</div>
