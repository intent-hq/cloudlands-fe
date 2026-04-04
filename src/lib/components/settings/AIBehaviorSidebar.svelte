<script lang="ts">
  import Fa from 'svelte-fa';
  import { faPlus, faGear } from '@fortawesome/free-solid-svg-icons';
  import {
    filterSpecialistsByGitHubAuth,
    selectSpecialists,
    selectIsBuiltIn,
    selectHasOverrides,
    selectUserOverrides,
  } from '$lib/store/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$lib/store/slices/github-auth/github-auth-selectors';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  // View type definition
  export type AIBehaviorView =
    | { type: 'system-prompt' }
    | { type: 'specialist'; id: string }
    | { type: 'create-specialist' };

  interface Props {
    activeView: AIBehaviorView;
    onSelect: (view: AIBehaviorView) => void;
  }

  let { activeView, onSelect }: Props = $props();

  const specialists = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($specialists, $isGitHubAuth$)
  );
  const userOverrides$ = selectUserOverrides();
  // Track override changes to trigger re-render (updates {@const} values in template)
  $effect(() => { void $userOverrides$; });

  // Check if a specialist ID is a built-in type for avatar rendering
  function isBuiltInSpecialistId(
    id: string,
  ): id is 'spec-writer' | 'implementor' | 'verifier' | 'pr-reviewer' | 'ui-designer' {
    return (
      id === 'spec-writer' ||
      id === 'implementor' ||
      id === 'verifier' ||
      id === 'pr-reviewer' ||
      id === 'ui-designer'
    );
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

<div class="w-52 flex flex-col shrink-0">
  <!-- System Prompt - fixed at top -->
  <button
    type="button"
    onclick={() => onSelect({ type: 'system-prompt' })}
    class="flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer
      {isSelected({ type: 'system-prompt' })
      ? 'bg-muted text-foreground'
      : 'hover:bg-muted/50 text-foreground'}"
  >
    <div
      class="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center text-primary shrink-0"
    >
      <Fa icon={faGear} class="w-3 h-3" />
    </div>
    <span class="text-sm font-medium">All agents</span>
  </button>

  <!-- Specialists section - scrollable with max height -->
  <div class="specialist-section mt-4 overflow-y-auto border-b-accent-foreground">
    <div
      class="px-3 py-1.5 text-ui font-semibold text-muted-foreground uppercase tracking-wider"
    >
      Specialists
    </div>
    {#each visibleSpecialists as specialist (specialist.id)}
      {@const isBuiltIn = selectIsBuiltIn.select(getReduxStore().getState(), specialist.id)}
      {@const hasOverrides = selectHasOverrides.select(getReduxStore().getState(), specialist.id)}
      {@const isCustomized = isBuiltIn && hasOverrides}

      <button
        type="button"
        onclick={() => onSelect({ type: 'specialist', id: specialist.id })}
        class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer
          {isSelected({ type: 'specialist', id: specialist.id })
          ? 'bg-muted text-foreground'
          : 'hover:bg-muted/50 text-foreground'}"
      >
        <!-- Avatar -->
        <div class="shrink-0">
          {#if isBuiltInSpecialistId(specialist.id)}
            <AuggieAvatar faceSeed="blank" colorSeed="blank" size={20} specialist={specialist.id} />
          {:else}
            <AuggieAvatar faceSeed="blank" colorSeed="blank" size={20} />
          {/if}
        </div>

        <!-- Name and badges -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm truncate">{specialist.name}</span>
            {#if isCustomized}
              <span
                class="text-ui px-1 py-0.5 rounded bg-primary/15 text-primary font-medium shrink-0"
              >
                Modified
              </span>
            {/if}
            {#if !isBuiltIn}
              <span
                class="text-ui px-1 py-0.5 rounded bg-warning/15 text-warning font-medium shrink-0"
              >
                Custom
              </span>
            {/if}
          </div>
        </div>
      </button>
    {/each}
    <!-- <div style="height: 2000px;">Mock spacer</div> -->
  </div>
  <!-- Create button - flows after specialists -->
  <button
    type="button"
    onclick={() => onSelect({ type: 'create-specialist' })}
    class="w-full flex items-center gap-2.5 mt-4 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer
        {isSelected({ type: 'create-specialist' })
      ? 'bg-muted text-foreground'
      : 'hover:bg-muted/50 text-muted-foreground hover:text-foreground'}"
  >
    <div
      class="w-5 h-5 rounded-md border border-dashed border-current flex items-center justify-center shrink-0"
    >
      <Fa icon={faPlus} class="w-2.5 h-2.5" />
    </div>
    <span class="text-sm">Create Specialist</span>
  </button>
</div>

<style>
  /* Warning color fallback */
  .text-warning {
    color: hsl(38, 92%, 50%);
  }
  .bg-warning\/15 {
    background-color: hsla(38, 92%, 50%, 0.15);
  }
  .specialist-section {
    max-height: calc(100vh - 25rem);
  }
</style>
