<script lang="ts">
  /**
   * Compact specialist dropdown for selecting/changing the agent specialist.
   * Shows the current specialist as a pill that opens a dropdown when clicked.
   */
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { workspacePickerStyles } from '$lib/components/workspace/initializer/workspace-picker-styles';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import {
    selectSpecialists,
    filterPickableSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { selectWorkspaceInitializerRecentSpecialistIds } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import { sortSpecialistsByRecency } from '$store/renderer/slices/workspace-initializer/utils/recent-specialists';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import SpecialistOptions from './SpecialistOptions.svelte';

  interface Props {
    /** Currently selected specialist ID - null means blank agent */
    value?: string | null;
    /** Callback when specialist changes */
    onchange?: (specialistId: string | null) => void;
    /** Visual treatment for the trigger */
    variant?: 'pill' | 'bare';
    /** Additional class */
    class?: string;
  }

  let { value = null, onchange, variant = 'pill', class: className }: Props = $props();

  let dropdownOpen = $state(false);

  // All available specialists (built-in + custom), filtered by GitHub auth.
  // Ordered like the New workspace picker: specialists used to create
  // workspaces first (most recent first), the rest in catalog order.
  const allSpecialists = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const recentSpecialistIds$ = selectWorkspaceInitializerRecentSpecialistIds();
  const visibleSpecialists = $derived.by(() =>
    sortSpecialistsByRecency(
      filterPickableSpecialists($allSpecialists, $isGitHubAuth$),
      $recentSpecialistIds$,
    ),
  );
  const selectedIcon = $derived($allSpecialists.find((s) => s.id === value)?.icon ?? null);

  // Get current specialist info
  const currentSpecialist = $derived(value ? $allSpecialists.find((s) => s.id === value) : null);

  // Display label
  const displayLabel = $derived(
    currentSpecialist?.name ?? value ?? m.chat_shared_general_fallback(),
  );

  function handleSelect(id: string | null) {
    if (id !== value) {
      onchange?.(id);
    }
    dropdownOpen = false;
  }
</script>

<DropdownMenu
  bind:open={dropdownOpen}
  align="start"
  side="bottom"
  contentClass="w-80 max-w-[calc(100vw-1rem)]"
>
  {#snippet trigger({ props })}
    <Button
      {...props}
      type="button"
      variant="plain"
      wrapContent={false}
      class={cn(
        variant === 'bare'
          ? workspacePickerStyles.bareTrigger
          : 'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-border bg-background hover:bg-muted transition-colors cursor-pointer',
        className,
      )}
    >
      {#if variant !== 'bare'}
        <AgentAvatar agentId="blank" variant="compact" specialist={value} icon={selectedIcon} />
      {/if}
      <span class={variant === 'bare' ? workspacePickerStyles.bareValue : 'text-subtle'}>
        {displayLabel}
      </span>
      <Fa
        icon={faChevronDown}
        class={variant === 'bare' ? workspacePickerStyles.bareChevron : 'text-ghost h-2.5 w-2.5'}
      />
    </Button>
  {/snippet}

  {#snippet content()}
    <div class="min-w-0">
      <SpecialistOptions specialists={visibleSpecialists} {value} onchange={handleSelect} />
    </div>
  {/snippet}
</DropdownMenu>
