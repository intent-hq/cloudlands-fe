<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { AgentActionPrimitive } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
    faRobot,
    faPlay,
    faArrowUpRightFromSquare,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { notify } from '$lib/components/patterns/notify';
  import { parseAgentTypeId } from '$shared/types/agent.types';
  import { selectSelectedModel } from '$store/renderer/slices/model/model-selectors';

  import { WorkspaceId } from '$shared/types/branded-ids';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    clearAgentCreationRequest,
    createAgentFromConfigRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { selectAgentCreationRequest } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('AgentActionBlock');

  // TipTap NodeViewProps
  let { node, updateAttributes, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as AgentActionPrimitive);

  // Component state
  let running = $state(false);
  let agentId = $state<string | null>(null);
  let requestStartedAt = $state('');
  let creationRequestHandled = $state(false);

  // Get workspaceId from extension options
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);
  // svelte-ignore state_referenced_locally -- node-view identity is fixed for this instance.
  const initialWorkspaceId = extension?.options?.workspaceId as string | undefined;
  const creationRequestId = globalThis.crypto.randomUUID();
  const creationRequest$ = selectAgentCreationRequest(initialWorkspaceId, creationRequestId);

  // Get button state
  let buttonState = $derived.by(() => {
    if (running) {
      return { label: m.notes_agentActionBlock_running_label(), icon: null };
    }
    if (agentId) {
      return {
        label: m.notes_agentActionBlock_view_label(),
        icon: faArrowUpRightFromSquare,
        spin: false,
      };
    }
    if (primitive?.lastRun?.status === 'success') {
      return { label: m.notes_agentActionBlock_done_label(), icon: faCheck, spin: false };
    }
    return { label: m.notes_agentActionBlock_run_label(), icon: faPlay, spin: false };
  });

  // Run the agent action
  function runAction() {
    if (!primitive || running) return;
    if (!workspaceId) {
      notify.error(m.notes_agentActionBlock_noWorkspace_error());
      return;
    }
    running = true;
    creationRequestHandled = false;

    const contextReferences =
      primitive.inputs?.map((input) => ({
        type: input.kind === 'semantic_ref' ? 'file' : input.kind,
        path: input.semanticId || input.pattern || input.heading,
        content: input.content,
      })) || [];
    requestStartedAt = new Date().toISOString();
    appStore.dispatch(
      createAgentFromConfigRequested(
        workspaceId,
        {
          name: primitive.goal.length > 40 ? primitive.goal.slice(0, 40) + '...' : primitive.goal,
          nameExplicitlySet: false,
          workspaceId: WorkspaceId(workspaceId),
          model: selectSelectedModel.select(appStore.state),
          agentType: parseAgentTypeId(primitive.agentId || '') || 'chat',
          source: 'agent-action-block',
          initialMessage: primitive.goal,
          contextReferences,
          metadata: { source: 'agent-action-block', primitiveId: primitive.id },
        },
        { requestId: creationRequestId },
      ),
    );
  }

  $effect(() => {
    const request = $creationRequest$;
    const wsId = workspaceId;
    if (!request || request.loading || !wsId || creationRequestHandled) return;
    creationRequestHandled = true;
    running = false;
    if (request.error) {
      const now = new Date().toISOString();
      agentId = null;
      logger.error('[runAction] Error running agent action', {
        error: request.error,
        workspaceId: wsId,
        agentId: primitive?.agentId,
      });
      updateAttributes?.({
        data: {
          ...primitive,
          lastRun: {
            status: 'error',
            startedAt: requestStartedAt,
            finishedAt: now,
            errorMessage: request.error,
          },
        },
      });
      notify.error(request.error);
    } else if (request.agentId) {
      agentId = request.agentId;
      updateAttributes?.({
        data: {
          ...primitive,
          createdByAgentId: agentId,
          lastRun: { status: 'running', startedAt: requestStartedAt },
        },
      });
      notify.success(m.notes_agentActionBlock_started_label());
    }
    appStore.dispatch(clearAgentCreationRequest(wsId, request.requestId));
  });

  // Handle button click
  function handleButtonClick(event: MouseEvent) {
    if (agentId) {
      const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      if (workspaceId) {
        appStore.dispatch(openAgentTabRequested(workspaceId, { agentId, sourcePanelId }));
      }
    } else {
      runAction();
    }
  }

  // Helper to dispatch open-agent with sourcePanelId
  function handleOpenAgent(event: MouseEvent, targetAgentId: string) {
    const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;
    if (workspaceId) {
      appStore.dispatch(
        openAgentTabRequested(workspaceId, {
          agentId: targetAgentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }
</script>

<NodeViewWrapper>
  {#if primitive}
    {@const linkedAgentId = agentId || primitive.createdByAgentId}
    <div
      class="ws-block-widget type-body my-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-foreground shadow-(--elevation-raised)"
    >
      {#if linkedAgentId}
        <!-- Show agent avatar that opens the agent panel -->
        <Button
          variant="ghost"
          type="button"
          class="shrink-0 rounded-sm transition-opacity hover:opacity-80"
          onclick={(e) => handleOpenAgent(e, linkedAgentId)}
          title={m.notes_agentActionBlock_viewAgent_tooltip()}
        >
          <AgentAvatar agentId={linkedAgentId} variant="compact" />
        </Button>
      {:else}
        <Fa icon={faRobot} size="sm" class="shrink-0 text-muted-foreground" />
      {/if}
      <span class="min-w-0 flex-1 truncate">
        {primitive.goal}
      </span>
      <Button
        variant="ghost-light"
        size="sm"
        class="type-caption shrink-0"
        onclick={handleButtonClick}
        disabled={running}
      >
        {#if running}
          <IntentMarkLoader size={12} />
        {:else if buttonState.icon}
          <Fa icon={buttonState.icon} size="xs" />
        {/if}
        {buttonState.label}
      </Button>
    </div>
  {:else}
    <div class="ws-block-widget type-caption my-2 text-muted-foreground">
      {m.notes_agentActionBlock_invalid_error()}
    </div>
  {/if}
</NodeViewWrapper>
