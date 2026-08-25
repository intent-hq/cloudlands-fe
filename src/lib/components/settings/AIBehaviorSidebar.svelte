<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import {
    filterSpecialistsByGitHubAuth,
    selectFileSpecialists,
    selectHasOverrides,
    selectSpecialists,
    selectSpecialistSourceLabel,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';

  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

  // View type definition
  export type AIBehaviorView =
    { type: 'system-prompt' } | { type: 'specialist'; id: string } | { type: 'create-specialist' };

  interface Props {
    activeView: AIBehaviorView;
    onSelect: (view: AIBehaviorView) => void;
  }

  let { activeView, onSelect }: Props = $props();

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
    if (activeView.type !== view.type) return false;
    if (view.type === 'specialist' && activeView.type === 'specialist') {
      return activeView.id === view.id;
    }
    return true;
  }
</script>

<div class="flex min-w-0 flex-col gap-0.5">
  <!-- System Prompt - fixed at top -->
  <button
    type="button"
    onclick={() => onSelect({ type: 'system-prompt' })}
    aria-current={isSelected({ type: 'system-prompt' }) ? 'true' : undefined}
    class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
      {isSelected({ type: 'system-prompt' })
      ? 'bg-muted text-foreground'
      : 'hover:bg-muted/50 text-foreground'}"
  >
    <span class="truncate text-xs font-medium">{m.settings_aiBehavior_sidebar_allAgents()}</span>
  </button>

  <!-- Specialists section -->
  <div class="min-w-0">
    {#each visibleSpecialists as specialist (specialist.id)}
      {@const hasOverrides = getHasOverrides(specialist.id)}
      {@const sourceLabel = selectSpecialistSourceLabel.select(appStore.state, specialist.id)}

      <button
        type="button"
        onclick={() => onSelect({ type: 'specialist', id: specialist.id })}
        aria-current={isSelected({ type: 'specialist', id: specialist.id }) ? 'true' : undefined}
        class="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
          {isSelected({ type: 'specialist', id: specialist.id })
          ? 'bg-muted text-foreground'
          : 'hover:bg-muted/50 text-foreground'}"
      >
        <!-- Name and project badge -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-xs">{specialist.name}</span>
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
  </div>
  <!-- Create button - flows after specialists -->
  <button
    type="button"
    onclick={() => onSelect({ type: 'create-specialist' })}
    aria-current={isSelected({ type: 'create-specialist' }) ? 'true' : undefined}
    class="mt-1 flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
        {isSelected({ type: 'create-specialist' })
      ? 'bg-muted text-foreground'
      : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'}"
  >
    <Fa icon={faPlus} class="h-3 w-3 shrink-0" />
    <span class="truncate text-xs">{m.settings_aiBehavior_sidebar_createSpecialist()}</span>
  </button>
</div>
