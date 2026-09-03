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
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import type { AgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import {
    selectAgentIsResponding,
    selectAgentIsWaiting,
    selectAgentProvider,
    selectAgentSession,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { selectPendingCount } from '$store/renderer/slices/permission/permission-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';
  import { handleLink } from '$features/navigation/link-handler';
  import {
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
  } from './subscription-disclosure';

  interface Props {
    attribution: AgentMessageAttribution;
    preview: string;
    expanded: boolean;
    controlsId: string;
    ontoggle: () => void;
    /** Explicit identity fallback for isolated surfaces before the sender session is available. */
    specialist?: string | null;
    /** Optional class name */
    class?: string;
  }

  let {
    attribution,
    preview,
    expanded,
    controlsId,
    ontoggle,
    specialist = null,
    class: className = '',
  }: Props = $props();

  const workspaceId = getWorkspaceRouteContext()?.workspaceId ?? undefined;
  const displayName = $derived(
    attribution.kind === 'chief' ? m.layout_chiefCard_title() : attribution.displayName,
  );
  // The component is keyed by message sender in the transcript. Initialize all
  // selector readables once so identity and semantic state stay live while the
  // message row remains mounted.
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by sender id.
  const senderSession$ = selectAgentSession(attribution.fromAgentId);
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by sender id.
  const senderIsResponding$ = selectAgentIsResponding(attribution.fromAgentId);
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by sender id.
  const senderIsWaiting$ = selectAgentIsWaiting(attribution.fromAgentId);
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by sender id.
  const senderPermissionCount$ = selectPendingCount(attribution.fromAgentId);
  // svelte-ignore state_referenced_locally -- selector readables are init-time only; instances are keyed by sender id.
  const senderProvider$ = selectAgentProvider(attribution.fromAgentId);
  const senderSpecialist = $derived(
    specialist ??
      $senderSession$?.metadata?.specialist ??
      $senderSession$?.agentMetadata?.specialist ??
      null,
  );
  const senderAttentionRequest = $derived(getAgentAttentionRequest($senderSession$));
  const senderAvatarState = $derived(
    getAvatarState(
      {
        isStreaming: $senderIsResponding$ && !$senderIsWaiting$,
        status: $senderIsWaiting$ ? 'waiting' : $senderSession$?.status,
      },
      {
        hasPermissionRequest: $senderPermissionCount$ > 0,
        attentionKind: senderAttentionRequest?.kind ?? null,
      },
    ),
  );

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Get source panel ID for same-panel navigation
    const panelElement = (e.currentTarget as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;

    if (workspaceId) {
      appStore.dispatch(
        openAgentTabRequested(workspaceId, {
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

  async function handleSourceClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (attribution.kind !== 'chief' || !attribution.sourceUrl) return;
    await handleLink(attribution.sourceUrl, { workspaceId, event });
  }
</script>

<div
  class="{SUBSCRIPTION_DISCLOSURE_ROW_CLASS} {className}"
  data-testid="agent-message-disclosure-header"
>
  {#if attribution.kind === 'chief' && attribution.sourceUrl}
    <a
      class="flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded text-left font-[inherit] text-muted-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style="max-width: calc(100% - 2.5rem);"
      href={attribution.sourceUrl}
      onclick={handleSourceClick}
      ondblclick={(event) => event.stopPropagation()}
      title={m.chat_msgAttribution_openSource_title()}
      data-testid="agent-message-attribution"
    >
      <span
        class={SUBSCRIPTION_LEADING_COLUMN_CLASS}
        aria-hidden="true"
        data-testid="agent-message-avatar-column"
        data-agent-message-leading-identity
      >
        <AgentAvatarWithState
          agentId={attribution.fromAgentId}
          specialist={senderSpecialist}
          provider={$senderProvider$}
          state={senderAvatarState}
          variant="standard"
        />
      </span>
      <span class="min-w-0 truncate font-normal text-muted-foreground" title={displayName}>
        {displayName}
      </span>
    </a>
  {:else if attribution.kind === 'chief'}
    <span
      class="flex min-w-0 shrink-0 items-center gap-2 text-left font-[inherit] text-muted-foreground"
      style="max-width: calc(100% - 2.5rem);"
      data-testid="agent-message-attribution"
    >
      <span
        class={SUBSCRIPTION_LEADING_COLUMN_CLASS}
        aria-hidden="true"
        data-testid="agent-message-avatar-column"
        data-agent-message-leading-identity
      >
        <AgentAvatarWithState
          agentId={attribution.fromAgentId}
          specialist={senderSpecialist}
          provider={$senderProvider$}
          state={senderAvatarState}
          variant="standard"
        />
      </span>
      <span class="min-w-0 truncate font-normal text-muted-foreground" title={displayName}>
        {displayName}
      </span>
    </span>
  {:else}
    <button
      type="button"
      class="flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded border-none bg-transparent p-0 text-left font-[inherit] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style="max-width: calc(100% - 2.5rem);"
      onclick={handleClick}
      ondblclick={(event) => event.stopPropagation()}
      title={m.chat_msgAttribution_openAgent_title({ name: displayName })}
      data-testid="agent-message-attribution"
    >
      <span
        class={SUBSCRIPTION_LEADING_COLUMN_CLASS}
        aria-hidden="true"
        data-testid="agent-message-avatar-column"
        data-agent-message-leading-identity
      >
        <AgentAvatarWithState
          agentId={attribution.fromAgentId}
          specialist={senderSpecialist}
          provider={$senderProvider$}
          state={senderAvatarState}
          variant="standard"
        />
      </span>
      <span
        class="min-w-0 truncate font-normal text-muted-foreground"
        title={displayName}
        data-testid="agent-message-actor-name"
      >
        {displayName}
      </span>
    </button>
  {/if}
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
    <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
      <span class="min-w-0 shrink truncate">{m.chat_msgAttribution_sentMessage_after()}</span>
      {#if preview}
        <span
          class="min-w-0 flex-1 truncate whitespace-nowrap text-muted-foreground"
          title={preview}
          data-testid="agent-message-preview"
        >
          — {preview}
        </span>
      {/if}
    </span>
    <span
      class="inline-flex h-6 w-6 shrink-0 items-center justify-center"
      data-testid="agent-message-chevron-column"
    >
      <Fa
        icon={faChevronDown}
        size={16}
        class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded
          ? ''
          : 'rotate-90'}"
      />
    </span>
  </button>
</div>
