<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { AgentActionPrimitive } from '$shared/types/notes-primitives';
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faRobot,
  faPlay,
  faSpinner,
  faArrowUpRightFromSquare,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import { toast } from 'svelte-sonner';
  import { parseAgentTypeId } from '$shared/types/agent.types';
  import { selectWorkspaceDefaultModel } from '$lib/store/slices/model/model-selectors';


  import { WorkspaceId } from '$shared/types/branded-ids';
  import { unifiedIdService } from '$shared/services/unified-id.service';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { createLogger } from '$lib/utils/client-logger';
  import { openAgentTabRequested } from '$lib/store/slices/app-layout/app-layout-slice';
  import { createAgentFromConfigRequested } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$lib/store/store';

  const logger = createLogger('AgentActionBlock');

  // TipTap NodeViewProps
  let { node, updateAttributes, extension }: NodeViewProps = $props();

  // Get primitive data from node
  let primitive = $derived(node?.attrs?.data as AgentActionPrimitive);

  // Component state
  let running = $state(false);
  let agentId = $state<string | null>(null);

  // Get workspaceId from extension options
  let workspaceId = $derived(extension?.options?.workspaceId as string | undefined);

  function getErrorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'Unknown error';
  }

  // Get button state
  let buttonState = $derived.by(() => {
    if (running) {
      return { label: 'Running...', icon: faSpinner, spin: true };
    }
    if (agentId) {
      return { label: 'View', icon: faArrowUpRightFromSquare, spin: false };
    }
    if (primitive?.lastRun?.status === 'success') {
      return { label: 'Done', icon: faCheck, spin: false };
    }
    return { label: 'Run', icon: faPlay, spin: false };
  });

  // Run the agent action
  async function runAction() {
    if (!primitive || running) return;
    if (!workspaceId) {
      toast.error('No space context available');
      return;
    }
    running = true;

    try {
      // Build context references from primitive inputs
      const contextReferences =
        primitive.inputs?.map((input) => ({
          type: input.kind === 'semantic_ref' ? 'file' : input.kind,
          path: input.semanticId || input.pattern || input.heading,
          content: input.content,
        })) || [];

      const newAgentId = unifiedIdService.generateAgentId();
      const state = appStore.state;
      const action = createAgentFromConfigRequested(workspaceId, {
        id: newAgentId,
        name: primitive.goal.length > 40 ? primitive.goal.slice(0, 40) + '...' : primitive.goal,
        workspaceId: WorkspaceId(workspaceId),
        model: selectWorkspaceDefaultModel.select(state, workspaceId),
        agentType: parseAgentTypeId(primitive.agentId || '') || 'chat',
        source: 'agent-action-block',
        initialMessage: primitive.goal,
        contextReferences,
        metadata: {
          source: 'agent-action-block',
          primitiveId: primitive.id,
        },
      });
      appStore.dispatch(action);

      const createdAgent = await action.promise;
      agentId = createdAgent.id || newAgentId;
      running = false;

      // Update primitive with running status and agent link
      const now = new Date().toISOString();
      if (updateAttributes) {
        updateAttributes({
          data: {
            ...primitive,
            createdByAgentId: agentId,
            lastRun: {
              status: 'running',
              startedAt: now,
            },
          },
        });
      }

      toast.success('Agent action started');
    } catch (err) {
      const errorMessage = getErrorMessage(err);
      logger.error('[runAction] Error running agent action', {
        error: err,
        workspaceId,
        agentId: primitive?.agentId,
      });
      running = false;
      agentId = null;

      // Update with error status
      if (updateAttributes && primitive) {
        const now = new Date().toISOString();
        updateAttributes({
          data: {
            ...primitive,
            lastRun: {
              status: 'error',
              startedAt: now,
              finishedAt: now,
              errorMessage,
            },
          },
        });
      }

      toast.error(errorMessage);
    }
  }

  // Handle button click
  function handleButtonClick(event: MouseEvent) {
    if (agentId) {
      const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
      const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
      if (workspaceId) {
        appStore.dispatch(
          openAgentTabRequested(workspaceId, { agentId, sourcePanelId }),
        );
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
    <div class="my-1.5 flex items-center gap-2">
      {#if linkedAgentId}
        <!-- Show agent avatar that opens the agent panel -->
        <button
          type="button"
          class="flex-none hover:opacity-80 transition-opacity cursor-pointer"
          onclick={(e) => handleOpenAgent(e, linkedAgentId)}
          title="View agent"
        >
          <AuggieAvatar agentId={linkedAgentId} size={16} />
        </button>
      {:else}
        <Fa icon={faRobot} size="sm" class="text-ghost flex-none" />
      {/if}
      <span class="text-sm text-subtle flex-1 min-w-0 truncate">
        {primitive.goal}
      </span>
      <Button
        variant="ghost-light"
        size="sm"
        class="h-6 px-2 text-xs text-subtle gap-1 flex-none"
        onclick={handleButtonClick}
        disabled={running}
      >
        <Fa icon={buttonState.icon} size="xs" class={buttonState.spin ? 'animate-spin' : ''} />
        {buttonState.label}
      </Button>
    </div>
  {:else}
    <div class="my-1.5 text-sm text-subtle">Invalid agent action block</div>
  {/if}
</NodeViewWrapper>
