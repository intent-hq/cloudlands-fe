<script lang="ts">
  import Fa from 'svelte-fa';
  import { faGlobe, faPlus } from '@fortawesome/free-solid-svg-icons';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import {
    filterSpecialistsByGitHubAuth,
    selectFileSpecialists,
    selectHasOverrides,
    selectSpecialists,
    selectSpecialistSourceLabel,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';

  import { Tooltip } from '$lib/components/ui/tooltip';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  // View type definition
  export type AIBehaviorView =
    { type: 'system-prompt' } | { type: 'specialist'; id: string } | { type: 'create-specialist' };

  interface Props {
    activeView: AIBehaviorView;
    onSelect: (view: AIBehaviorView) => void;
    isActive?: boolean;
  }

  let { activeView, onSelect, isActive = true }: Props = $props();

  const specialists = selectSpecialists();
  const fileSpecialists$ = selectFileSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($specialists, $isGitHubAuth$),
  );

  function getHasOverrides(id: string): boolean {
    void $fileSpecialists$; // track file specialist changes for reactivity
    return selectHasOverrides.select(appStore.state, id);
  }

  // Check if item is selected
  function isSelected(view: AIBehaviorView): boolean {
    if (!isActive) return false;
    if (activeView.type !== view.type) return false;
    if (view.type === 'specialist' && activeView.type === 'specialist') {
      return activeView.id === view.id;
    }
    return true;
  }
</script>

<!-- System Prompt - fixed at top -->
<button
  id="specialists"
  type="button"
  onclick={() => onSelect({ type: 'system-prompt' })}
  data-highlight-id="agents"
  data-settings-agent-row
  use:highlightTarget
  aria-current={isSelected({ type: 'system-prompt' }) ? 'true' : undefined}
  class="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
    {isSelected({ type: 'system-prompt' })
    ? 'bg-muted font-medium text-foreground shadow-xs'
    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
>
  <span
    data-settings-all-agents-icon
    aria-hidden="true"
    class="flex size-4 shrink-0 items-center justify-center opacity-75"
  >
    <Fa icon={faGlobe} size="sm" />
  </span>
  <span class="truncate">
    {m.settings_aiBehavior_sidebar_allAgents()}
  </span>
</button>

<!-- Specialists -->
{#each visibleSpecialists as specialist (specialist.id)}
  {@const hasOverrides = getHasOverrides(specialist.id)}
  {@const sourceLabel = selectSpecialistSourceLabel.select(appStore.state, specialist.id)}

  <button
    id={`specialist-${specialist.id}`}
    type="button"
    onclick={() => onSelect({ type: 'specialist', id: specialist.id })}
    data-highlight-id={`specialist-${specialist.id}`}
    data-settings-agent-row
    use:highlightTarget
    aria-current={isSelected({ type: 'specialist', id: specialist.id }) ? 'true' : undefined}
    class="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
      {isSelected({ type: 'specialist', id: specialist.id })
      ? 'bg-muted font-medium text-foreground shadow-xs'
      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
  >
    <AgentAvatar
      agentId={specialist.id}
      specialist={specialist.id}
      variant="compact"
      class="shrink-0"
    />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <span class="truncate">{specialist.name}</span>
        {#if hasOverrides}
          <span
            data-specialist-modified-marker
            aria-hidden="true"
            class="text-ui shrink-0 leading-none text-muted-foreground"
          >
            *
          </span>
        {/if}
        {#if sourceLabel === 'Project'}
          <Tooltip
            content={m.settings_aiBehavior_sidebar_projectBadgeTooltip()}
            side="right"
            delayDuration={400}
          >
            <span
              class="text-ui px-1 py-0.5 rounded font-medium shrink-0 bg-primary/15 text-primary"
            >
              {m.settings_aiBehavior_sidebar_projectBadge()}
            </span>
          </Tooltip>
        {/if}
      </div>
    </div>
  </button>
{/each}

<!-- Create button - flows after specialists -->
<button
  id="create-specialist"
  type="button"
  onclick={() => onSelect({ type: 'create-specialist' })}
  data-highlight-id="create-specialist"
  data-settings-agent-row
  use:highlightTarget
  aria-current={isSelected({ type: 'create-specialist' }) ? 'true' : undefined}
  class="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
    {isSelected({ type: 'create-specialist' })
    ? 'bg-muted font-medium text-foreground shadow-xs'
    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
>
  <Fa icon={faPlus} class="h-3 w-3 shrink-0" />
  <span class="truncate">{m.settings_aiBehavior_sidebar_createSpecialist()}</span>
</button>
