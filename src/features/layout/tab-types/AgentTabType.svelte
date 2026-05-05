<script lang="ts">
  /**
   * Agent Tab Type Component
   *
   * Renders an agent chat panel with header actions for copy, delete, task note, and font style.
   */

  import { untrack } from 'svelte';
  import type { TabTypeComponentProps } from './registry';
  import { closeTab } from '$lib/store/slices/panel-layout/panel-layout-slice';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { agentService } from '$features/agent/agent-ipc-bridge';
  import { subscribeToAgent } from '$features/agent/browser';
  import { useAgentSession } from '$lib/hooks/useAgentSession.svelte';
  import { selectInitialAgentId } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { selectWorkspaceById } from '$lib/store/slices/workspace/workspace-selectors';
  import type { AgentSession } from '$shared/types';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToNote } from '$lib/utils/workspace-navigation';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import { cycleFontStyle } from '$lib/store/slices/user-preferences/user-preferences-slice';
  import {
    selectAgentFontStyleLabel,
    selectIsAgentMonospace,
  } from '$lib/store/slices/user-preferences/user-preferences-selectors';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';
  import {
    selectSpecialistName,
    selectSpecialists,
  } from '$lib/store/slices/specialists/specialists-selectors';
  import Fa from 'svelte-fa';
  import { faCheck, faCircleInfo, faCopy, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { formatAgentMessagesForClipboard } from '$lib/utils/clipboard-formatters';
  import { TooltipRich } from '$lib/components/ui/tooltip';
  import AgentStatsTooltip from '$lib/components/chat/AgentStatsTooltip.svelte';
  import {
    AGENT_STATS_TOOLTIP_TITLE,
    AGENT_STATS_TRIGGER_LABEL,
  } from '$lib/components/chat/agent-stats-tooltip-copy';
  import {
    selectAgentStats,
    selectIsLoadingAgentStats,
    selectAgentStatsError,
  } from '$lib/store/slices/session-stats/session-stats-selectors';
  import { fetchAgentStats } from '$lib/store/slices/session-stats/session-stats-slice';
  import { isAuggieSession } from '$shared/types/agent-session';

  const logger = createLogger('AgentTabType');

  const dispatch = getDispatch();
  const fontStyleLabel = selectAgentFontStyleLabel();
  const isMonospace = selectIsAgentMonospace();

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  // Cache $workspace to prevent destruction during store reloads
  const workspace = $derived(selectWorkspaceById(workspaceId));
  const defaultModel = $derived(selectWorkspaceDefaultModel(workspaceId));

  // Reactive store subscription for specialist names
  const specialists$ = selectSpecialists();

  // Check if this agent is the initial workspace agent (created during onboarding)
  const initialAgentId$ = selectInitialAgentId(workspaceId);
  const isInitialWorkspaceAgent = $derived(
    !!(workspaceId && tab.agentId && $initialAgentId$ === tab.agentId),
  );

  // Get agent model from session, falling back to $workspace default
  const agent$ = useAgentSession(() => tab.agentId);
  const agentModel = $derived($agent$?.model || $defaultModel);

  // Subscribe to agent session updates
  let agentSession = $state<AgentSession | undefined>(undefined);
  $effect(() => {
    if (!tab.agentId) {
      agentSession = undefined;
      return;
    }
    const unsubscribe = subscribeToAgent(tab.agentId, (session) => {
      agentSession = session;
    });
    return () => {
      unsubscribe();
    };
  });

  const agentMessages = $derived(agentSession?.messages || []);

  // Get specialist display name
  const agentSpecialistName = $derived.by(() => {
    void $specialists$;
    if (!tab.agentId) return null;
    const specialistId =
      agentSession?.metadata?.specialist || (agentSession as any)?.agentMetadata?.specialist;
    if (!specialistId) return null;
    return selectSpecialistName.select(getReduxStore().getState(), specialistId);
  });

  // Resolve "Delegated by" reactively once the parent session is loaded into Redux.
  const parentAgentId = $derived((agentSession?.metadata?.createdByAgentId as string) || null);
  const parentAgent$ = useAgentSession(() => parentAgentId);
  const delegatedByName = $derived(parentAgentId ? $parentAgent$?.name || null : null);

  // Get task note ID
  const agentTaskNoteId = $derived(
    agentSession?.metadata?.taskNoteId || agentSession?.agentMetadata?.taskNoteId || null,
  );

  // Agent stats selectors (for info-circle tooltip). Mirrors AgentCard.svelte.
  // Fall back to empty-string arg so the derived value is always a Readable;
  // rendering is gated on tab.agentId in the template.
  const agentStats$ = $derived(selectAgentStats(tab.agentId ?? ''));
  const agentStatsLoading$ = $derived(selectIsLoadingAgentStats(tab.agentId ?? ''));
  const agentStatsError$ = $derived(selectAgentStatsError(tab.agentId ?? ''));
  let statsTooltipOpen = $state(false);
  let agentStatsFetchPending = $state(false);
  let ignoredAgentStatsError: string | undefined = $state(undefined);
  const agentStatsLoading = $derived(agentStatsFetchPending || ($agentStatsLoading$ ?? false));
  const agentStatsError = $derived(
    agentStatsFetchPending ? undefined : ($agentStatsError$ ?? undefined),
  );
  const agentStatsSession = $derived.by(() => {
    if (!tab.agentId) return undefined;
    return agentService.getSession(tab.agentId) ?? agentSession;
  });
  const showAgentStatsAction = $derived(
    !!agentStatsSession && isAuggieSession(agentStatsSession),
  );
  const agentStatsEmptyState = $derived.by(() => {
    if (!tab.agentId) return 'empty' as const;
    if (!agentStatsSession) return undefined;
    if (!isAuggieSession(agentStatsSession)) return 'empty' as const;
    return agentStatsSession.acpSessionId || agentStatsSession.backendSessionId
      ? undefined
      : ('empty' as const);
  });

  $effect(() => {
    void tab.agentId;
    agentStatsFetchPending = false;
    ignoredAgentStatsError = undefined;
  });

  $effect(() => {
    if (!agentStatsFetchPending) return;

    const currentError = $agentStatsError$ ?? undefined;
    if (
      $agentStatsLoading$ ||
      $agentStats$ ||
      (currentError && currentError !== ignoredAgentStatsError)
    ) {
      agentStatsFetchPending = false;
      ignoredAgentStatsError = undefined;
    }
  });

  function handleStatsTooltipOpenChange(isOpen: boolean) {
    if (!isOpen) {
      statsTooltipOpen = false;
      return;
    }

    if (!tab.agentId) {
      statsTooltipOpen = true;
      return;
    }

    // On-demand fetch: dispatch fetchAgentStats before opening the tooltip so
    // the first visible render sees the loading state instead of empty stats.
    // Dispatching on every open attempt lets the reducer clear any prior
    // error optimistically so the user can retry after a failed fetch.
    // Only Auggie sessions go through `auggie session stats`; skip other
    // providers so the tooltip surfaces no data instead of a stale error.
    const session = agentService.getSession(tab.agentId) ?? agentSession;
    if (!session || !isAuggieSession(session)) {
      statsTooltipOpen = false;
      return;
    }

    const sessionId = session.acpSessionId || session.backendSessionId;
    if (sessionId) {
      if (!$agentStats$ || $agentStatsError$) {
        ignoredAgentStatsError = $agentStatsError$ ?? undefined;
        agentStatsFetchPending = true;
      }
      getReduxStore().dispatch(fetchAgentStats(tab.agentId, sessionId));
    }
    statsTooltipOpen = true;
  }

  // Copy/delete state
  let agentCopyFeedback = $state<string | null>(null);
  let agentCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isAgentDeleting = $state(false);

  function handleGoToTaskNote(e?: MouseEvent) {
    if (!agentTaskNoteId) return;
    const openInAdjacentPanel = e?.metaKey || e?.ctrlKey || false;
    const panelElement = (e?.target as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    navigateToNote(agentTaskNoteId, { openInAdjacentPanel, sourcePanelId });
  }

  async function handleCopyAgentConversation() {
    if (!tab.agentId || agentMessages.length === 0) return;
    try {
      const formattedText = formatAgentMessagesForClipboard(agentMessages);
      await navigator.clipboard.writeText(formattedText);
      agentCopyFeedback = 'Copied!';
      if (agentCopyTimeoutId) clearTimeout(agentCopyTimeoutId);
      agentCopyTimeoutId = setTimeout(() => {
        agentCopyFeedback = null;
        agentCopyTimeoutId = null;
      }, 2000);
    } catch (error) {
      logger.error('Failed to copy conversation', error);
    }
  }

  async function handleDeleteAgent() {
    if (!tab.agentId || isAgentDeleting) return;
    const agentIdToDelete = tab.agentId;
    const agentName = agentSession?.name || tab.title || '';
    isAgentDeleting = true;
    try {
      getReduxStore().dispatch(closeTab(workspaceId, tab.id));
      await agentService.deleteSessionWithUndo({
        agentId: agentIdToDelete,
        workspaceId,
        agentName,
      });
    } catch (error) {
      logger.error('Failed to delete agent', error);
    } finally {
      isAgentDeleting = false;
    }
  }

  // Register header state and actions
  $effect(() => {
    if (!headerContext || !isActive) return;
    const subtitleParts: string[] = [];
    if (agentSpecialistName) subtitleParts.push(agentSpecialistName);
    if (delegatedByName) subtitleParts.push(`Delegated by ${delegatedByName}`);
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined;
    untrack(() => {
      headerContext.registerActions(agentActions);
      headerContext.registerState({ subtitle });
    });
  });
</script>

{#snippet agentActions()}
  {#if agentTaskNoteId}
    <Button
      variant="ghost-light"
      size="icon-xs"
      onclick={handleGoToTaskNote}
      tooltip="Go to task note"
      tooltipSide="bottom"
    >
      <Fa icon={faNote} size="xs" />
    </Button>
  {/if}
  {#if tab.agentId && showAgentStatsAction}
    <TooltipRich
      title={AGENT_STATS_TOOLTIP_TITLE}
      side="bottom"
      align="end"
      delayDuration={300}
      interactive
      open={agentStatsError ? false : statsTooltipOpen}
      onOpenChange={handleStatsTooltipOpenChange}
      class="h-6 items-center align-middle"
    >
      {#snippet content()}
        <AgentStatsTooltip
          stats={$agentStats$ ?? undefined}
          loading={agentStatsLoading}
          error={agentStatsError}
          emptyState={agentStatsEmptyState}
        />
      {/snippet}
      <Button
        variant="ghost-light"
        size="icon-xs"
        aria-label={AGENT_STATS_TRIGGER_LABEL}
        class="cursor-default"
      >
        <Fa icon={faCircleInfo} size="xs" />
      </Button>
    </TooltipRich>
  {/if}
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => dispatch(cycleFontStyle())}
    tooltip={`Font: ${$fontStyleLabel}`}
    tooltipSide="bottom"
  >
    <span class="text-xs font-semibold tracking-tight" class:font-mono={$isMonospace}>Aa</span>
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={handleCopyAgentConversation}
    tooltip={agentCopyFeedback || 'Copy conversation'}
    tooltipSide="bottom"
    disabled={agentMessages.length === 0}
    class={agentCopyFeedback ? 'text-success' : ''}
  >
    <Fa icon={agentCopyFeedback ? faCheck : faCopy} size="xs" />
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={handleDeleteAgent}
    tooltip="Delete agent"
    tooltipSide="bottom"
    disabled={isAgentDeleting}
    class="hover:text-destructive-foreground"
  >
    <Fa icon={faTrash} size="xs" />
  </Button>
{/snippet}

{#if tab.agentId}
  {#if $workspace}
    {#key tab.agentId}
      <div class="w-full h-full flex-1 flex pb-1.5">
        <ChatPanel
          workspace={$workspace}
          agentId={tab.agentId}
          {agentModel}
          {isActive}
          {isPanelFocused}
          {isInitialWorkspaceAgent}
        />
      </div>
    {/key}
  {:else}
    <div class="flex items-center justify-center h-full text-subtle">
      <p>Loading space...</p>
    </div>
  {/if}
{/if}
