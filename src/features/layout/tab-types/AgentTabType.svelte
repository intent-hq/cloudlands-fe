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
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';
  import type { ChatNavigationState } from '$lib/components/chat/chat-message-navigation';
  import * as Menu from '$lib/components/ui/menu';
  import AgentViewSettingsDropdown from './AgentViewSettingsDropdown.svelte';

  import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';
  import {
    selectSpecialistName,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import {
    faCheck,
    faCircleInfo,
    faCopy,
    faRightLeft,
    faTrash,
    faUserTie,
  } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import HarnessFeaturesModal from '$lib/components/chat/HarnessFeaturesModal.svelte';
  import ReplaceAgentModal from '$lib/components/modals/ReplaceAgentModal.svelte';
  import { formatAgentMessagesForClipboard } from '$lib/utils/clipboard-formatters';
  import { isReplaceAgentEligible } from '$shared/utils/replace-agent-eligibility';
  import { m } from '$shared/paraglide/messages.js';
  import { sendMessage } from '$store/renderer/slices/chat-state/chat-state-slice';
  import { deleteAgentWithUndoRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';

  const logger = createLogger('AgentTabType');

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
  const defaultModel = selectSelectedModel();

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
    if (!isActive || !tab.agentId) {
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

  // Get specialist display name, falling back to the raw id when the
  // lookup misses (parity with AgentCard).
  const agentSpecialistName = $derived.by(() => {
    void $specialists$;
    if (!tab.agentId) return null;
    const specialistId =
      agentSession?.metadata?.specialist || (agentSession as any)?.agentMetadata?.specialist;
    if (!specialistId) return null;
    return selectSpecialistName.select(appStore.state, specialistId) ?? specialistId;
  });

  // Resolve "Delegated by" reactively once the parent session is loaded into Redux.
  const parentAgentId = $derived((agentSession?.metadata?.createdByAgentId as string) || null);
  const parentAgent$ = useAgentSession(() => parentAgentId);
  const delegatedByName = $derived(parentAgentId ? $parentAgent$?.name || null : null);

  // Get task note ID
  const agentTaskNoteId = $derived(
    agentSession?.metadata?.taskNoteId || agentSession?.agentMetadata?.taskNoteId || null,
  );

  // Read-only harness version stamp (PROTOCOL §5.5). Mirrors the AgentCard
  // context-menu entry: hidden for sessions from daemons that predate the
  // field; selecting the item opens the read-only harness-features modal
  // (monorepo#2459). Legacy sessions without a harnessFeatures snapshot
  // still open the modal — every catalog feature renders OFF.
  const harnessVersion = $derived($agent$?.harnessVersion ?? null);
  const harnessFeatures = $derived($agent$?.harnessFeatures ?? null);
  let harnessModalOpen = $state(false);

  // "Replace Agent" (peer-agent hand-off) — hidden unless every session-derived
  // eligibility gate passes: harnessFeatures.peerAgents snapshot true,
  // top-level, non-background, not retired. Mirrors the AgentCard context menu.
  const canReplaceAgent = $derived(isReplaceAgentEligible($agent$));
  let replaceAgentModalOpen = $state(false);

  // Raw specialist id (not the display name) — interpolated into the built
  // hand-off instruction's `ws.agent.create` call shape.
  const agentSpecialistId = $derived(
    ((agentSession?.metadata?.specialist ||
      (agentSession as any)?.agentMetadata?.specialist) as string) || null,
  );

  // Send the (possibly edited) hand-off instruction through the normal chat
  // send path so it lands in the transcript as a regular user message.
  function handleReplaceAgentSend(text: string) {
    if (!tab.agentId) return;
    appStore.dispatch(
      sendMessage(tab.agentId, {
        wsId: workspaceId,
        text,
        agentName: agentSession?.name || tab.title || '',
        agentModel,
        isInitialWorkspaceAgent,
      }),
    );
  }

  // Copy/delete state
  let agentCopyFeedback = $state<string | null>(null);
  let agentCopyTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let isAgentDeleting = $state(false);
  let chatPanelRef = $state<{
    scrollToBottom: () => void;
    navigateToUserMessage: (messageId: string) => Promise<boolean>;
    refreshUserMessageIndex: () => void;
  } | null>(null);
  let chatNavigationState = $state<ChatNavigationState>({
    isAtBottom: true,
    userMessages: [],
    isLoadingUserMessageIndex: false,
  });

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
    if (delegatedByName)
      subtitleParts.push(m.layout_panelTabBar_delegatedBy_label({ name: delegatedByName }));
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined;
    untrack(() => {
      headerContext.registerActions({
        primary: agentPrimaryActions,
        display: agentDisplayActions,
        actions: agentActions,
      });
      headerContext.registerState({ subtitle });
    });
  });
</script>

{#snippet agentPrimaryActions()}
  <ChatMessageNavigator
    messages={chatNavigationState.userMessages}
    isAtBottom={chatNavigationState.isAtBottom}
    isLoadingIndex={chatNavigationState.isLoadingUserMessageIndex}
    onSelectMessage={(messageId) => chatPanelRef?.navigateToUserMessage(messageId) ?? false}
    onScrollToBottom={() => chatPanelRef?.scrollToBottom()}
    onOpen={() => chatPanelRef?.refreshUserMessageIndex()}
  />
{/snippet}

{#snippet agentDisplayActions()}
  <AgentViewSettingsDropdown embedded />
{/snippet}

{#snippet agentActions()}
  {#if agentTaskNoteId}
    <Menu.CommandItem
      icon={faNote}
      label={m.layout_agentTab_goToTaskNote_tooltip()}
      onclick={(event) => handleGoToTaskNote(event)}
    />
  {/if}
  <Menu.CommandItem
    icon={agentCopyFeedback ? faCheck : faCopy}
    label={agentCopyFeedback || m.layout_agentTab_copyConversation_tooltip()}
    onclick={handleCopyAgentConversation}
    disabled={agentMessages.length === 0}
  />
  {#if canReplaceAgent}
    <Menu.CommandItem
      icon={faRightLeft}
      label={m.layout_agentTab_replaceAgent_tooltip()}
      onclick={() => (replaceAgentModalOpen = true)}
    />
  {/if}
  <Menu.CommandItem
    icon={faTrash}
    label={m.layout_agentTab_deleteAgent_tooltip()}
    onclick={handleDeleteAgent}
    disabled={isAgentDeleting}
    destructive
  />
  {#if agentSpecialistName || harnessVersion}
    <Menu.Separator />
    {#if agentSpecialistName}
      <Menu.CommandItem
        icon={faUserTie}
        label={m.chat_agentCard_menu_specialist_label({ name: agentSpecialistName })}
        disabled
      />
    {/if}
    {#if harnessVersion}
      <Menu.CommandItem
        icon={faCircleInfo}
        label={m.chat_agentCard_menu_harnessVersion_label({ version: harnessVersion })}
        onclick={() => (harnessModalOpen = true)}
      />
    {/if}
  {/if}
{/snippet}

{#if harnessVersion}
  <HarnessFeaturesModal
    bind:open={harnessModalOpen}
    version={harnessVersion}
    features={harnessFeatures}
  />
{/if}

{#if replaceAgentModalOpen}
  <ReplaceAgentModal
    bind:open={replaceAgentModalOpen}
    agentName={agentSession?.name || tab.title || ''}
    specialist={agentSpecialistId}
    onSend={handleReplaceAgentSend}
  />
{/if}

{#if tab.agentId}
  {#if $workspace}
    {#key tab.agentId}
      <div class="flex h-full min-h-0 w-full flex-1">
        <ChatPanel
          bind:this={chatPanelRef}
          workspace={$workspace}
          agentId={tab.agentId}
          {agentModel}
          {isActive}
          {isPanelFocused}
          {isInitialWorkspaceAgent}
          onNavigationStateChange={(state) => (chatNavigationState = state)}
        />
      </div>
    {/key}
  {:else}
    <div class="flex items-center justify-center h-full text-subtle">
      <p>{m.layout_agentTab_loadingSpace_label()}</p>
    </div>
  {/if}
{/if}
