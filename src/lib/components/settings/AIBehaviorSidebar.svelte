<script lang="ts">
  import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import { ListRow } from '$lib/components/patterns/collection';
  import {
    filterSpecialistsByGitHubAuth,
    selectFileSpecialists,
    selectHasOverrides,
    selectSpecialists,
    selectSpecialistSourceLabel,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';

  import { Button, Tooltip } from '$lib/components/patterns/settings/custom-controls';
  import { highlightTarget } from '$lib/components/patterns/settings/highlight-target';
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
  let specialistButtonRefs = $state<Record<string, HTMLButtonElement | null>>({});
  let createSpecialistButtonRef = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    const targets = [...Object.values(specialistButtonRefs), createSpecialistButtonRef].filter(
      (target): target is HTMLButtonElement => target !== null,
    );
    const actions = targets.map((target) => highlightTarget(target));
    return () => actions.forEach((action) => action.destroy());
  });

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

<!-- Specialists -->
{#each visibleSpecialists as specialist (specialist.id)}
  {@const hasOverrides = getHasOverrides(specialist.id)}
  {@const sourceLabel = selectSpecialistSourceLabel.select(appStore.state, specialist.id)}

  <Button
    bind:ref={specialistButtonRefs[specialist.id]}
    variant="plain"
    id={`specialist-${specialist.id}`}
    type="button"
    onclick={() => onSelect({ type: 'specialist', id: specialist.id })}
    data-highlight-id={`specialist-${specialist.id}`}
    data-settings-agent-row
    active={isSelected({ type: 'specialist', id: specialist.id })}
    aria-current={isSelected({ type: 'specialist', id: specialist.id }) ? 'page' : undefined}
    class="h-auto w-full min-w-0 justify-start rounded-lg p-0 text-left type-caption font-normal hover:bg-hover active:bg-active
      {isSelected({ type: 'specialist', id: specialist.id })
      ? 'bg-foreground/5 text-foreground'
      : 'text-muted-foreground'}"
  >
    <ListRow class="min-h-8 w-full gap-2 px-3 py-0">
      {#snippet leading()}
        <AgentAvatar
          agentId={specialist.id}
          specialist={specialist.id}
          variant="compact"
          class="shrink-0"
        />
      {/snippet}
      {#snippet title()}
        <span
          data-settings-sidebar-label
          class="flex min-w-0 items-center gap-1.5 type-body font-normal"
        >
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
                class="type-caption shrink-0 rounded bg-muted px-1 py-0.5 font-medium text-muted-foreground"
              >
                {m.settings_aiBehavior_sidebar_projectBadge()}
              </span>
            </Tooltip>
          {/if}
        </span>
      {/snippet}
    </ListRow>
  </Button>
{/each}

<!-- Create button - flows after specialists -->
<Button
  bind:ref={createSpecialistButtonRef}
  variant="plain"
  id="create-specialist"
  type="button"
  onclick={() => onSelect({ type: 'create-specialist' })}
  data-highlight-id="create-specialist"
  data-settings-agent-row
  active={isSelected({ type: 'create-specialist' })}
  aria-current={isSelected({ type: 'create-specialist' }) ? 'page' : undefined}
  class="h-auto w-full min-w-0 justify-start rounded-lg p-0 text-left type-caption font-normal hover:bg-hover active:bg-active
    {isSelected({ type: 'create-specialist' })
    ? 'bg-foreground/5 text-foreground'
    : 'text-muted-foreground'}"
>
  <ListRow class="min-h-8 w-full gap-2 px-3 py-0">
    {#snippet leading()}
      <span class="flex size-4 shrink-0 items-center justify-center">
        <PlusIcon size={16} weight="regular" />
      </span>
    {/snippet}
    {#snippet title()}
      <span data-settings-sidebar-label class="block truncate type-body font-normal">
        {m.settings_aiBehavior_sidebar_createSpecialist()}
      </span>
    {/snippet}
  </ListRow>
</Button>
