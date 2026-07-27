<script lang="ts">
  /**
   * Agent Tab Type Component
   *
   * Renders an agent chat panel with header actions for copy, delete, task note, and font style.
   */

  import { onDestroy, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import type { TabTypeComponentProps } from './registry';
  import { closeTab } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { subscribeToAgent } from '$features/agent/browser';
  import { useAgentSession } from '$lib/hooks/useAgentSession.svelte';
  import { selectInitialAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';

  import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
  import type { AgentSession } from '$shared/types';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToNote } from '$lib/utils/workspace-navigation';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import { cycleFontStyle } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
  selectAgentFontStyleLabel,
  selectIsAgentMonospace,
} from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  import { selectWorkspaceDefaultModel } from '$store/renderer/slices/model/model-selectors';
  import {
  selectSpecialistName,
  selectSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';
  import Fa from 'svelte-fa';
  import {
  faCheck,
  faCopy,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { formatAgentMessagesForClipboard } from '$lib/utils/clipboard-formatters';
  import { m } from '$shared/paraglide/messages.js';
  import { deleteAgentWithUndoRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('AgentTabType');

  const fontStyleLabel = selectAgentFontStyleLabel();
  const isMonospace = selectIsAgentMonospace();

  let { tab, workspaceId, isActive, isPanelFocused }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();

  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  $effect(() => {
    agentIdStore.set(tab.agentId ?? '');
  });

  // Cache $workspace to prevent destruction during store reloads
  const workspace = selectWorkspaceById(workspaceIdStore);
  const defaultModel = selectWorkspaceDefaultModel(workspaceIdStore);

  // Reactive store subscription for specialist names
  const specialists$ = selectSpecialists();

  // Check if this agent is the initial workspace agent (created during onboarding)
  const initialAgentId$ = selectInitialAgentId(workspaceIdStore);
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
    return selectSpecialistName.select(appStore.state, specialistId);
  });

  // Resolve "Delegated by" reactively once the parent session is loaded into Redux.
  const parentAgentId = $derived((agentSession?.metadata?.createdByAgentId as string) || null);
  const parentAgent$ = useAgentSession(() => parentAgentId);
  const delegatedByName = $derived(parentAgentId ? $parentAgent$?.name || null : null);

  // Get task note ID
  const agentTaskNoteId = $derived(
    agentSession?.metadata?.taskNoteId || agentSession?.agentMetadata?.taskNoteId || null,
  );

  // Copy/delete state
  let agentCopyFeedback = $state<string | null>(null);
  let agentCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isAgentDeleting = $state(false);

  onDestroy(() => {
    if (agentCopyTimeoutId) {
      clearTimeout(agentCopyTimeoutId);
      agentCopyTimeoutId = null;
    }
  });

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
      agentCopyFeedback = m.layout_agentTab_copied_label();
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
      appStore.dispatch(closeTab(workspaceId, tab.id));
      const action = deleteAgentWithUndoRequested(workspaceId, agentIdToDelete, agentName);
      appStore.dispatch(action);
      await action.promise;
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
    if (delegatedByName) subtitleParts.push(m.layout_panelTabBar_delegatedBy_label({ name: delegatedByName }));
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
      tooltip={m.layout_agentTab_goToTaskNote_tooltip()}
      tooltipSide="bottom"
    >
      <Fa icon={faNote} size="xs" />
    </Button>
  {/if}
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => appStore.dispatch(cycleFontStyle())}
    tooltip={m.layout_agentTab_font_tooltip({ font: $fontStyleLabel })}
    tooltipSide="bottom"
  >
    <span class="text-xs font-semibold tracking-tight" class:font-mono={$isMonospace}
      >{m.layout_agentTab_fontSample_label()}</span
    >
  </Button>
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={handleCopyAgentConversation}
    tooltip={agentCopyFeedback || m.layout_agentTab_copyConversation_tooltip()}
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
    tooltip={m.layout_agentTab_deleteAgent_tooltip()}
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
      <p>{m.layout_agentTab_loadingSpace_label()}</p>
    </div>
  {/if}
{/if}
