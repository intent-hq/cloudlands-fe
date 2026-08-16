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
  import * as Menu from '$lib/components/ui/menu';
  import AgentViewSettingsDropdown from './AgentViewSettingsDropdown.svelte';

  import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';
  import {
    selectSpecialistName,
    selectSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { faCheck, faCircleInfo, faCopy, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { formatAgentMessagesForClipboard } from '$lib/utils/clipboard-formatters';
  import { m } from '$shared/paraglide/messages.js';
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

  // Read-only harness version stamp (PROTOCOL §5.5). Mirrors the AgentCard
  // context-menu entry: hidden for sessions from daemons that predate the
  // field; when the session carries a harnessFeatures snapshot the entry is
  // a flyout listing each feature's on/off state (check = on), otherwise a
  // plain disabled item. Informational only — never actionable.
  const harnessVersion = $derived($agent$?.harnessVersion ?? null);
  const harnessFeatureEntries = $derived(
    Object.entries($agent$?.harnessFeatures ?? {}).sort(([a], [b]) => a.localeCompare(b)),
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
    if (delegatedByName)
      subtitleParts.push(m.layout_panelTabBar_delegatedBy_label({ name: delegatedByName }));
    const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined;
    untrack(() => {
      headerContext.registerActions({ display: agentDisplayActions, actions: agentActions });
      headerContext.registerState({ subtitle });
    });
  });
</script>

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
  <Menu.CommandItem
    icon={faTrash}
    label={m.layout_agentTab_deleteAgent_tooltip()}
    onclick={handleDeleteAgent}
    disabled={isAgentDeleting}
    destructive
  />
  {#if harnessVersion}
    <Menu.Separator />
    {#if harnessFeatureEntries.length > 0}
      <Menu.Sub>
        <Menu.SubTrigger>
          <Fa icon={faCircleInfo} size="xs" class="w-4 shrink-0 text-muted-foreground opacity-70" />
          <span class="min-w-0 flex-1 truncate">
            {m.chat_agentCard_menu_harnessVersion_label({ version: harnessVersion })}
          </span>
        </Menu.SubTrigger>
        <Menu.SubContent>
          {#each harnessFeatureEntries as [feature, enabled] (feature)}
            <!-- Wire identifier from the §5.12 feature catalog, rendered
                 verbatim. i18n-ignore (daemon-provided identifier). The icon
                 column is always reserved so on/off labels align. -->
            <Menu.Item disabled>
              <span class="flex w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {#if enabled}
                  <Fa icon={faCheck} size="xs" class="text-muted-foreground opacity-70" />
                {/if}
              </span>
              <span class="min-w-0 flex-1 truncate">{feature}</span>
            </Menu.Item>
          {/each}
        </Menu.SubContent>
      </Menu.Sub>
    {:else}
      <Menu.CommandItem
        icon={faCircleInfo}
        label={m.chat_agentCard_menu_harnessVersion_label({ version: harnessVersion })}
        disabled
      />
    {/if}
  {/if}
{/snippet}

{#if tab.agentId}
  {#if $workspace}
    {#key tab.agentId}
      <div class="flex h-full min-h-0 w-full flex-1">
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
