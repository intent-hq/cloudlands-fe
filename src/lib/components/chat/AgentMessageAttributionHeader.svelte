<script lang="ts">
  /**
   * AgentMessageAttributionHeader
   *
   * Subscription-style sender disclosure for agent-to-agent messages. Agent
   * navigation and disclosure are sibling actions so neither can activate the
   * other and the card never nests interactive controls.
   */
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import { getAvatarStateForSession } from '$features/agent/components/agent-avatar/avatar-state';
  import type { AgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import {
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
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
  } from './subscription-disclosure';

  interface Props {
    attribution: AgentMessageAttribution;
    expanded: boolean;
    controlsId: string;
    ontoggle: () => void;
    /** Pinned controls return to the source instead of navigating or expanding. */
    onPinnedActivate?: () => void;
    /** Explicit identity fallback for isolated surfaces before the sender session is available. */
    specialist?: string | null;
    /** Optional class name */
    class?: string;
  }

  let {
    attribution,
    expanded,
    controlsId,
    ontoggle,
    onPinnedActivate,
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
    getAvatarStateForSession($senderSession$, {
      hasPermissionRequest: $senderPermissionCount$ > 0,
      attentionKind: senderAttentionRequest?.kind ?? null,
    }),
  );

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (onPinnedActivate) {
      onPinnedActivate();
      return;
    }

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
    (onPinnedActivate ?? ontoggle)();
  }

  async function handleSourceClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (attribution.kind !== 'chief' || !attribution.sourceUrl) return;
    await handleLink(attribution.sourceUrl, { workspaceId, event });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (pinned activation also lives on the sibling buttons) -->
<!-- svelte-ignore a11y_no_static_element_interactions (only enlarges the pinned buttons' hit area) -->
<div
  class={cn(
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    'h-auto! py-1.5! [&_[data-slot=button]]:h-auto!',
    className,
  )}
  data-testid="agent-message-disclosure-header"
  onclick={onPinnedActivate ? () => onPinnedActivate?.() : undefined}
>
  {#if attribution.kind === 'chief' && attribution.sourceUrl && !onPinnedActivate}
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
      <span class="min-w-0 font-normal wrap-anywhere whitespace-normal text-muted-foreground">
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
      <span class="min-w-0 font-normal wrap-anywhere whitespace-normal text-muted-foreground">
        {displayName}
      </span>
    </span>
  {:else}
    <Button
      type="button"
      variant="plain"
      class="{SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} flex min-h-6 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded border-none bg-transparent p-0 text-left font-[inherit] whitespace-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      truncateLabel={false}
      style="max-width: calc(100% - 2.5rem);"
      onclick={handleClick}
      ondblclick={(event) => event.stopPropagation()}
      title={onPinnedActivate
        ? m.chat_stickyMessageHeader_scrollToPrevious_title()
        : m.chat_msgAttribution_openAgent_title({ name: displayName })}
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
        class="min-w-0 font-normal wrap-anywhere whitespace-normal text-muted-foreground"
        data-testid="agent-message-actor-name"
      >
        {displayName}
      </span>
    </Button>
  {/if}
  <Button
    type="button"
    variant="plain"
    class="{SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded border-none bg-transparent p-0 text-left font-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    onclick={handleToggle}
    ondblclick={(event) => event.stopPropagation()}
    aria-expanded={onPinnedActivate ? undefined : expanded}
    aria-controls={onPinnedActivate ? undefined : controlsId}
    aria-label={onPinnedActivate
      ? m.chat_stickyMessageHeader_scrollToPrevious_title()
      : m.chat_msgAttribution_sentMessage_after()}
    data-testid="agent-message-disclosure-toggle"
  >
    <span class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
      <span class="min-w-0 shrink truncate" data-testid="agent-message-status">
        {m.chat_msgAttribution_sentMessage_after()}
      </span>
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
  </Button>
</div>
