<script lang="ts">
  /**
   * Compact specialist dropdown for selecting/changing the agent specialist.
   * Shows the current specialist as a pill that opens a dropdown when clicked.
   */
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import {
    selectSpecialists,
    filterSpecialistsByGitHubAuth,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';

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

  // All available specialists (built-in + custom), filtered by GitHub auth
  const allSpecialists = selectSpecialists();
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const visibleSpecialists = $derived.by(() =>
    filterSpecialistsByGitHubAuth($allSpecialists, $isGitHubAuth$),
  );

  // Get current specialist info
  const currentSpecialist = $derived(value ? $allSpecialists.find((s) => s.id === value) : null);

  // Display label
  const displayLabel = $derived(currentSpecialist?.name ?? 'General');

  function handleSelect(id: string | null) {
    if (id !== value) {
      onchange?.(id);
    }
    dropdownOpen = false;
  }
</script>

<DropdownMenu bind:open={dropdownOpen} align="start" side="bottom">
  {#snippet trigger({ toggle }: { toggle: () => void })}
    <button
      type="button"
      onclick={toggle}
      class={cn(
        variant === 'bare'
          ? 'group inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-normal leading-5 text-foreground transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer'
          : 'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-border bg-background hover:bg-muted transition-colors cursor-pointer',
        className,
      )}
    >
      {#if variant !== 'bare'}
        <AuggieAvatar seed="blank" size={16} specialist={value} />
      {/if}
      <span
        class={variant === 'bare'
          ? 'min-w-0 flex-1 truncate text-left text-foreground font-normal'
          : 'text-subtle'}
      >
        {displayLabel}
      </span>
      <Fa
        icon={faChevronDown}
        class={variant === 'bare'
          ? 'h-2.5 w-2.5 shrink-0 text-ghost opacity-70'
          : 'text-ghost h-2.5 w-2.5'}
      />
    </button>
  {/snippet}

  {#snippet content()}
    <div class="py-1 min-w-[180px]">
      <!-- Blank agent option -->
      <button
        type="button"
        class={cn(
          'flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors',
          'hover:bg-muted rounded-sm cursor-pointer',
          value === null ? 'bg-muted/50' : '',
        )}
        onclick={() => handleSelect(null)}
      >
        <AuggieAvatar seed="blank" size={20} specialist={null} />
        <div class="flex flex-col">
          <span class="font-medium text-foreground">General</span>
          <span class="text-xs text-subtle">No specialized behavior</span>
        </div>
      </button>

      <div class="h-px bg-border my-1"></div>

      <!-- Specialists -->
      {#each visibleSpecialists as specialist (specialist.id)}
        <button
          type="button"
          class={cn(
            'flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors',
            'hover:bg-muted rounded-sm cursor-pointer',
            value === specialist.id ? 'bg-muted/50' : '',
          )}
          onclick={() => handleSelect(specialist.id)}
        >
          <AuggieAvatar seed="blank" size={20} specialist={specialist.id} />
          <div class="flex flex-col min-w-0">
            <span class="font-medium text-foreground">{specialist.name}</span>
            <span class="text-xs text-subtle truncate">{specialist.description}</span>
          </div>
        </button>
      {/each}
    </div>
  {/snippet}
</DropdownMenu>
