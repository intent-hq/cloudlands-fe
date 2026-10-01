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
  import { onDestroy } from 'svelte';
  import { v4 as uuidv4 } from 'uuid';
  import { parseAgentTypeId } from '$shared/types/agent.types';
  import {
    selectContextSelectedModel,
    selectContextDefaultProvider,
  } from '$store/renderer/slices/provider-catalog/workspace-catalog-selectors';
  import { selectHidesAgentLifecycleActions } from '$store/renderer/slices/workspace/workspace-selectors';
  import { writable } from 'svelte/store';

  import { WorkspaceId } from '$shared/types/branded-ids';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    clearAgentCreationOutcome,
    createAgentFromConfigRequested,
  } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { selectAgentCreationOutcome } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  // TipTap NodeViewProps
  let { node, updateAttributes, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as AgentActionPrimitive);
  const primitiveId = $derived(primitive?.id ?? '');

  // Get workspaceId from extension options
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);
  const wsIdStore = writable<string>('');
  const resourceIdStore = writable<string>('');
  const consumerId = uuidv4();
  $effect(() => {
    wsIdStore.set(workspaceId ?? '');
    resourceIdStore.set(primitiveId);
    return () => appStore.dispatch(clearAgentCreationOutcome(consumerId));
  });
  const creationOutcome$ = selectAgentCreationOutcome(consumerId, wsIdStore, resourceIdStore);
  const running = $derived($creationOutcome$?.status === 'pending');
  const agentId = $derived($creationOutcome$?.agentId ?? primitive?.createdByAgentId ?? null);
  onDestroy(() => appStore.dispatch(clearAgentCreationOutcome(consumerId)));
  // Running the action creates an agent (`agent.create`), refused (-32003) for
  // a collaborator connection: the run affordance is withheld. Viewing an
  // already-linked agent is not a lifecycle action and stays available.
  const hidesAgentLifecycleActions$ = selectHidesAgentLifecycleActions(wsIdStore);

  // TipTap owns this widget's document. Consume only this mount/resource's
  // acknowledged result; business work and notifications remain saga-owned.
  $effect(() => {
    const outcome = $creationOutcome$;
    if (
      !outcome ||
      outcome.status === 'pending' ||
      !primitive ||
      outcome.workspaceId !== workspaceId ||
      outcome.resourceId !== primitiveId
    )
      return;
    if (outcome.status === 'success') {
      updateAttributes?.({
        data: {
          ...primitive,
          createdByAgentId: outcome.agentId,
          lastRun: { status: 'running', startedAt: outcome.completedAt },
        },
      });
    } else if (outcome.status === 'failure') {
      updateAttributes?.({
        data: {
          ...primitive,
          lastRun: {
            status: 'error',
            startedAt: outcome.completedAt,
            finishedAt: outcome.completedAt,
            errorMessage: outcome.error,
          },
        },
      });
    }
    appStore.dispatch(clearAgentCreationOutcome(consumerId, outcome.seq));
  });

  // Get button state
  let buttonState = $derived.by(() => {
    if (running) {
      return { label: m.notes_agentActionBlock_running_label(), icon: null };
    }
    if (agentId) {
      return {
        label: m.notes_agentActionBlock_view_label(),
        icon: faArrowUpRightFromSquare,
      };
    }
    if (primitive?.lastRun?.status === 'success') {
      return { label: m.notes_agentActionBlock_done_label(), icon: faCheck };
    }
    return { label: m.notes_agentActionBlock_run_label(), icon: faPlay };
  });

  // Run the agent action
  function runAction() {
    if (!primitive || running || (workspaceId && $hidesAgentLifecycleActions$)) return;
    const wsId = workspaceId ?? '';
    // Build context references from primitive inputs
    const contextReferences =
      primitive.inputs?.map((input) => ({
        type: input.kind === 'semantic_ref' ? 'file' : input.kind,
        path: input.semanticId || input.pattern || input.heading,
        content: input.content,
      })) || [];

    const state = appStore.state;
    const action = createAgentFromConfigRequested(
      wsId,
      {
        name: primitive.goal.length > 40 ? primitive.goal.slice(0, 40) + '...' : primitive.goal,
        // Derived from the primitive goal, not user-chosen — keep the session
        // self-renameable.
        nameExplicitlySet: false,
        workspaceId: WorkspaceId(wsId),
        model: selectContextSelectedModel.select(state, wsId),
        provider: selectContextDefaultProvider.select(state, wsId),
        agentType: parseAgentTypeId(primitive.agentId || '') || 'chat',
        source: 'agent-action-block',
        initialMessage: primitive.goal,
        contextReferences,
        metadata: {
          source: 'agent-action-block',
          primitiveId: primitive.id,
        },
      },
      { consumer: { id: consumerId, resourceId: primitive.id } },
    );
    appStore.dispatch(action);
  }

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
          type="button"
          variant="ghost"
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
      {#if agentId || !$hidesAgentLifecycleActions$}
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
      {/if}
    </div>
  {:else}
    <div class="ws-block-widget type-caption my-2 text-muted-foreground">
      {m.notes_agentActionBlock_invalid_error()}
    </div>
  {/if}
</NodeViewWrapper>
