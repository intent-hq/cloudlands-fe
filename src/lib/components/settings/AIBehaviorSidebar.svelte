<script lang="ts">
  import Fa from 'svelte-fa';
  import {
  faPlus,
  faGear,
  faArrowUpRightFromSquare,
  faPencil,
} from '@fortawesome/free-solid-svg-icons';
  import {
  filterSpecialistsByGitHubAuth,
  selectSpecialists,
  selectIsBuiltIn,
  selectHasOverrides,
  selectSpecialistSourceLabel,
  selectUserOverrides,
} from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { openSpecialistsFolder } from '$store/renderer/slices/specialists/specialists-slice';

  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';

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
    <span class="text-sm font-medium">{m.settings_aiBehavior_sidebar_allAgents()}</span>
  </button>

  <!-- Specialists section - scrollable with max height -->
  <div class="specialist-section mt-4 overflow-y-auto border-b-accent-foreground">
    <div
      class="px-3 py-1.5 flex items-center justify-between"
    >
      <span class="text-ui font-semibold text-muted-foreground uppercase tracking-wider">
        {m.settings_aiBehavior_sidebar_specialistsSection()}
      </span>
      <Tooltip
        content={m.settings_aiBehavior_sidebar_openFolderTooltip()}
        side="right"
        delayDuration={300}
      >
        <button
          type="button"
          onclick={() => appStore.dispatch(openSpecialistsFolder())}
          class="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          aria-label={m.settings_aiBehavior_sidebar_openFolderAriaLabel()}
        >
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
        </button>
      </Tooltip>
    </div>

    {#each visibleSpecialists as specialist (specialist.id)}
      {@const isBuiltIn = selectIsBuiltIn.select(appStore.state, specialist.id)}
      {@const hasOverrides = selectHasOverrides.select(appStore.state, specialist.id)}
      {@const sourceLabel = selectSpecialistSourceLabel.select(appStore.state, specialist.id)}
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
            <AuggieAvatar seed="blank" size={20} specialist={specialist.id} />
          {:else}
            <AuggieAvatar seed="blank" size={20} />
          {/if}
        </div>

        <!-- Name, path, and badges -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm truncate">{specialist.name}</span>
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
        {#if isCustomized}
          <span class="text-primary shrink-0" title={m.settings_aiBehavior_sidebar_modifiedTitle()}>
            <Fa icon={faPencil} class="w-2.5 h-2.5" />
          </span>
        {/if}
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
    <span class="text-sm">{m.settings_aiBehavior_sidebar_createSpecialist()}</span>
  </button>
</div>

<style>
  .specialist-section {
    max-height: calc(100vh - 25rem);
  }
</style>
