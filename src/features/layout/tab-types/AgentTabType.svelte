<script lang="ts">
  /**
   * Agent Tab Type Component
   *
   * Renders an agent chat panel with header actions for copy, delete, task note, and font style.
   */

  import type { TabTypeComponentProps } from './registry';
  import { getPanelLayoutManager } from '../panel-layout-manager.svelte';
  import { getPanelHeaderContext } from '$lib/components/layout/panel-system/panel-header-context.svelte';
  import { workspaceStore } from '$features/workspace/workspace.store.svelte';
  import { agentService } from '$features/agent/agent.service';
  import { sessionStore, subscribeToAgent } from '$features/agent/browser';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import type { AgentSession, Workspace } from '$shared/types';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToNote } from '$lib/utils/workspace-navigation';
  import ChatPanel from '$lib/components/chat/ChatPanel.svelte';
  import { Button } from '$lib/components/ui/button';
  import { agentFontSettings } from '$lib/stores/agent-font-settings.store.svelte';
  import { modelStore } from '$lib/stores/model.store.svelte';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';
  import { untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCheck, faCopy, faTrash } from '@fortawesome/free-solid-svg-icons';
  import { faNote } from '$lib/icons/faNote';
  import { formatAgentMessagesForClipboard } from '$lib/utils/clipboard-formatters';

  const logger = createLogger('AgentTabType');

  let { tab, workspaceId, isActive }: TabTypeComponentProps = $props();

  const headerContext = getPanelHeaderContext();
  const layoutManager = $derived(getPanelLayoutManager(workspaceId));

  // Cache workspace to prevent destruction during store reloads
  let cachedWorkspace: Workspace | null = $state(null);
  const storeWorkspace = $derived(workspaceStore.findById(WorkspaceId(workspaceId)) ?? null);
  $effect(() => {
    if (storeWorkspace) {
      untrack(() => {
        cachedWorkspace = storeWorkspace;
      });
    }
  });
  const workspace = $derived.by(() => {
    if (storeWorkspace) return storeWorkspace;
    if (cachedWorkspace && cachedWorkspace.id === workspaceId) return cachedWorkspace;
    return null;
  });

  // Get agent model from session, falling back to workspace default
  const agentModel = $derived.by(() => {
    if (tab.agentId) {
      const session = sessionStore.getSession(tab.agentId);
      if (session?.model) return session.model;
    }
    return modelStore.getWorkspaceDefaultModel(workspaceId);
  });

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
    if (!tab.agentId) return null;
    const specialistId =
      agentSession?.metadata?.specialist || (agentSession as any)?.agentMetadata?.specialist;
    if (!specialistId) return null;
    return specialistsStore.getSpecialistName(specialistId);
  });

  // Get parent agent info
  const parentAgentId = $derived((agentSession?.metadata?.createdByAgentId as string) || null);
  const delegatedByName = $derived.by(() => {
    if (!parentAgentId) return null;
    const parentSession = agentService.getSession(parentAgentId);
    return parentSession?.name || null;
  });

  // Get task note ID
  const agentTaskNoteId = $derived(
    agentSession?.metadata?.taskNoteId || agentSession?.agentMetadata?.taskNoteId || null,
  );

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
      layoutManager.closeTab(tab.id);
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
    headerContext.registerActions(agentActions);
    const subtitleParts: string[] = [];
    if (agentSpecialistName) subtitleParts.push(agentSpecialistName);
    if (delegatedByName) subtitleParts.push(`Delegated by ${delegatedByName}`);
    headerContext.registerState({
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined,
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
  <Button
    variant="ghost-light"
    size="icon-xs"
    onclick={() => agentFontSettings.cycleFontStyle()}
    tooltip={`Font: ${agentFontSettings.fontStyleLabel}`}
    tooltipSide="bottom"
  >
    <span
      class="text-xs font-semibold tracking-tight"
      class:font-mono={agentFontSettings.isMonospace}>Aa</span
    >
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
    class="hover:text-destructive"
  >
    <Fa icon={faTrash} size="xs" />
  </Button>
{/snippet}

{#if tab.agentId}
  {#if workspace}
    {#key tab.agentId}
      <div class="w-full h-full flex-1 flex pb-1.5">
        <ChatPanel {workspace} agentId={tab.agentId} {agentModel} {isActive} />
      </div>
    {/key}
  {:else}
    <div class="flex items-center justify-center h-full text-muted-foreground">
      <p>Loading space...</p>
    </div>
  {/if}
{/if}
