<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import DiagramPresentation from '$lib/components/diagrams/DiagramPresentation.svelte';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { getWorkspaceRouteContext } from '$lib/utils/workspace-route-context';

  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import {
    openWorkspaceFile,
    openWorkspaceNote,
  } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
  import { store as appStore } from '$store/renderer/store';
  import { getNavigationContext } from '$lib/components/layout/panel-system/panel-context';
  import { m } from '$shared/paraglide/messages.js';

  const workspaceId = getWorkspaceRouteContext()?.workspaceId;

  // TipTap NodeViewProps
  let { node, selected, updateAttributes }: NodeViewProps = $props();

  // Extract primitive data
  let primitive = $derived<DiagramPrimitive | null>(node.attrs.data);

  // Expanded state
  let expanded = $state(true);

  function toggleExpanded() {
    expanded = !expanded;
  }

  // Handle diagram updates
  function handleDiagramUpdate(updates: Partial<DiagramPrimitive>) {
    if (!primitive || !updateAttributes) return;

    updateAttributes({
      data: {
        ...primitive,
        ...updates,
      },
    });
  }

  function toSentenceCase(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  // Display name
  let displayName = $derived(
    toSentenceCase(
      primitive?.label ||
        m.notes_diagramBlock_grammarDiagram_label({ grammar: primitive?.grammar ?? '' }),
    ),
  );

  // Handle binding clicks - dispatch nav action directly
  function handleBindingClick(e: MouseEvent, binding: { type: string; target: string }) {
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const wsId = workspaceId;
    if (!wsId) return;
    const { type, target } = binding;
    if (type === 'file' && target) {
      appStore.dispatch(openWorkspaceFile(wsId, target, { openInAdjacentPanel, sourcePanelId }));
    } else if (type === 'note' && target) {
      appStore.dispatch(openWorkspaceNote(wsId, target, { openInAdjacentPanel, sourcePanelId }));
    }
  }
</script>

<NodeViewWrapper>
  {#if primitive}
    {@const linkedAgentId = primitive.createdByAgentId}
    <DiagramPresentation kind="custom" selected={Boolean(selected)} fileName={displayName}>
      {#snippet header()}
        <div class="flex min-w-0 items-center gap-2">
          {#if linkedAgentId}
            <!-- Show agent avatar that opens the agent panel -->
            <button
              type="button"
              class="flex-none hover:opacity-80 transition-opacity cursor-pointer"
              onclick={(event) => {
                const agentWsId = workspaceId;
                if (agentWsId) {
                  appStore.dispatch(
                    openAgentTabRequested(agentWsId, {
                      agentId: linkedAgentId,
                      ...getNavigationContext(event),
                    }),
                  );
                }
              }}
              title={m.notes_diagramBlock_viewAgent_tooltip()}
            >
              <AgentAvatar agentId={linkedAgentId} variant="compact" />
            </button>
          {/if}
          <button
            type="button"
            class="flex items-center gap-1.5 text-subtle transition-colors flex-1 min-w-0 cursor-pointer"
            onclick={toggleExpanded}
          >
            <Fa
              icon={faChevronDown}
              size="sm"
              class="flex-none text-ghost transition-transform {expanded ? '' : 'rotate-90'}"
            />
            <span class="text-sm truncate">{displayName}</span>
            {#if primitive.states && primitive.states.length > 0}
              <span class="text-xs text-subtle">
                {m.notes_diagramBlock_stateCount_label({ count: primitive.states.length })}
              </span>
            {/if}
          </button>
        </div>
      {/snippet}

      <!-- Expanded content -->
      {#if expanded}
        <div transition:slide={{ duration: 150 }}>
          <DiagramRenderer
            diagram={primitive}
            onUpdate={handleDiagramUpdate}
            editable={false}
            onBindingClick={handleBindingClick}
          />
        </div>
      {/if}
    </DiagramPresentation>
  {:else}
    <DiagramPresentation kind="custom" selected={Boolean(selected)} exportable={false}>
      <div class="text-sm text-subtle">{m.notes_diagramBlock_invalid_error()}</div>
    </DiagramPresentation>
  {/if}
</NodeViewWrapper>
