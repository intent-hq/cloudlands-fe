<script lang="ts">
  /**
   * Chat Header Component
   *
   * Displays the header for the chat panel including agent info,
   * model selector, and action buttons.
   */

  import { AgentStatus } from '$shared/types/agent.types';
  import type { AgentSession, PendingAgentSession } from '$shared/types';
  import { isPendingAgentSession } from '$shared/types';
  import Fa from 'svelte-fa';
  import {
    faRobot,
    faTrash,
    faSearch,
    faChevronDown,
    faSpinner,
  } from '@fortawesome/free-solid-svg-icons';
  import { Badge } from '$lib/components/ui/badge';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { SPECIALISTS } from '$lib/constants/specialists';
  import { specialistsStore } from '$lib/stores/specialists.store.svelte';

  interface Props {
    session: AgentSession | PendingAgentSession | null;
    selectedModel: string;
    isModelLocked: boolean;
    showSearch: boolean;
    onModelChange: (model: string) => void;
    onDelete: () => void;
    onSearchToggle: () => void;
  }

  let {
    session,
    selectedModel,
    isModelLocked,
    showSearch,
    onModelChange,
    onDelete,
    onSearchToggle,
  }: Props = $props();

  // Get specialist info from session metadata using unified lookup
  // Includes built-in and custom specialists
  const specialistInfo = $derived.by(() => {
    if (!session || isPendingAgentSession(session)) return null;
    const specialistId = session.metadata?.specialist || session.agentMetadata?.specialist;
    if (!specialistId) return null;
    return specialistsStore.getSpecialistById(specialistId);
  });

  // Get effective model for specialist with proper reactivity
  // Access overridesLoaded to establish reactivity - when overrides load, this will re-evaluate
  const specialistEffectiveModel = $derived.by(() => {
    const _overridesLoaded = specialistsStore.overridesLoaded;
    if (!specialistInfo) return '';
    return specialistsStore.getEffectiveModel(specialistInfo.id);
  });

  const models = [
    { value: 'sonnet4.5', label: 'Claude 3.5 Sonnet' },
    { value: 'haiku3.5', label: 'Claude 3.5 Haiku' },
    { value: 'opus3', label: 'Claude 3 Opus' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'o1-preview', label: 'o1 Preview' },
    { value: 'o1-mini', label: 'o1 Mini' },
  ];

  let showModelDropdown = $state(false);

  function handleModelSelect(model: string) {
    onModelChange(model);
    showModelDropdown = false;
  }

  function getAgentTitle(): string {
    if (!session) return 'Chat';

    if (isPendingAgentSession(session)) {
      return session.name || 'New Chat';
    }

    return session.name || 'Chat';
  }

  function getAgentStatus(): string {
    if (!session) return '';

    if (isPendingAgentSession(session)) {
      return 'Initializing...';
    }

    switch (session.status) {
      case AgentStatus.Active:
        return 'Active';
      case AgentStatus.Idle:
        return 'Idle';
      case AgentStatus.Error:
        return 'Error';
      default:
        return session.status || '';
    }
  }

  function getStatusClass(): string {
    if (!session) return '';

    if (isPendingAgentSession(session)) {
      return 'text-yellow-500';
    }

    switch (session.status) {
      case AgentStatus.Active:
        return 'text-green-500';
      case AgentStatus.Error:
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  }
</script>

<div class="flex justify-between items-center p-4 border-b border-border bg-muted/50">
  <div class="flex items-center gap-4">
    <div class="flex items-center gap-3">
      <Fa icon={faRobot} class="text-2xl text-muted-foreground" />
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <h3 class="text-base font-semibold m-0 text-foreground">{getAgentTitle()}</h3>
          {#if specialistInfo}
            <!-- Provider ensures proper context and cleanup during component destruction -->
            <Tooltip.Provider>
              <Tooltip.Root>
                <Tooltip.Trigger>
                  <Badge variant="secondary" class="text-xs px-2 py-0.5 cursor-help">
                    {specialistInfo.name}
                  </Badge>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <div class="space-y-1 max-w-xs">
                    <div class="font-semibold">{specialistInfo.name}</div>
                    <div class="text-xs text-muted-foreground">{specialistInfo.description}</div>
                    <div class="text-xs text-muted-foreground mt-1">
                      Model: <span class="font-mono">{specialistEffectiveModel}</span>
                    </div>
                  </div>
                </Tooltip.Content>
              </Tooltip.Root>
            </Tooltip.Provider>
          {/if}
        </div>
        {#if session}
          <span class="text-xs flex items-center {getStatusClass()}">
            {#if isPendingAgentSession(session)}
              <Fa icon={faSpinner} class="animate-spin mr-1" />
            {/if}
            {getAgentStatus()}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex items-center gap-4">
    <!-- Model Selector -->
    {#if !isModelLocked}
      <div class="relative">
        <button
          class="flex items-center px-3 py-2 bg-background border border-border rounded-md text-foreground text-sm cursor-pointer transition-all duration-200 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={() => (showModelDropdown = !showModelDropdown)}
          disabled={isModelLocked}
        >
          <span>
            {models.find((m) => m.value === selectedModel)?.label || selectedModel}
          </span>
          <Fa icon={faChevronDown} class="ml-1" />
        </button>

        {#if showModelDropdown}
          <div
            class="absolute top-full right-0 mt-1 bg-background border border-border rounded-md shadow-lg z-1000 min-w-[200px]"
          >
            {#each models as model (model.value)}
              <button
                class="block w-full px-3 py-2 text-left bg-transparent border-none text-foreground text-sm cursor-pointer transition-colors duration-200 hover:bg-muted {model.value ===
                selectedModel
                  ? 'bg-muted font-semibold'
                  : ''}"
                onclick={() => handleModelSelect(model.value)}
              >
                {model.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Action Buttons -->
    <div class="flex gap-2">
      <button
        class="p-2 bg-transparent border-none text-muted-foreground cursor-pointer rounded-md transition-all duration-200 hover:bg-muted hover:text-foreground {showSearch
          ? 'bg-muted text-primary'
          : ''}"
        onclick={onSearchToggle}
        title="Search messages"
      >
        <Fa icon={faSearch} />
      </button>

      <button
        class="p-2 bg-transparent border-none text-muted-foreground cursor-pointer rounded-md transition-all duration-200 hover:bg-muted hover:text-destructive-foreground"
        onclick={onDelete}
        title="Delete chat"
      >
        <Fa icon={faTrash} />
      </button>
    </div>
  </div>
</div>
