<script lang="ts">
  /**
   * Compact specialist dropdown for selecting/changing the agent specialist.
   * Shows the current specialist as a pill that opens a dropdown when clicked.
   */
  import { cn } from '$lib/utils';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import {
    selectSpecialists,
    filterPickableSpecialists,
  } from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';

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
    filterPickableSpecialists($allSpecialists, $isGitHubAuth$),
  );
  const selectedIcon = $derived($allSpecialists.find((s) => s.id === value)?.icon ?? null);

  // Get current specialist info
  const currentSpecialist = $derived(value ? $allSpecialists.find((s) => s.id === value) : null);

  // Display label
  const displayLabel = $derived(currentSpecialist?.name ?? m.chat_shared_general_fallback());

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
          ? 'group inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-normal leading-5 text-foreground transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer'
          : 'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full border border-border bg-background hover:bg-muted transition-colors cursor-pointer',
        className,
      )}
    >
      {#if variant !== 'bare'}
        <AgentAvatar agentId="blank" variant="compact" specialist={value} icon={selectedIcon} />
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
    </Button>
  {/snippet}

  {#snippet content()}
    <div class="min-w-0">
      <!-- Blank agent option -->
      <Menu.Item
        class={cn(
          'h-auto min-h-(--control-height-medium) gap-2 w-full py-2 text-left',
          value === null ? 'bg-muted/50' : '',
        )}
        onSelect={() => handleSelect(null)}
      >
        <AgentAvatar agentId="blank" variant="standard" specialist={null} />
        <div class="flex flex-col min-w-0 flex-1">
          <span class="text-foreground truncate">{m.chat_shared_general_fallback()}</span>
          <span class="text-xs text-subtle truncate"
            >{m.chat_shared_noSpecializedBehavior_label()}</span
          >
        </div>
      </Menu.Item>

      <div class="h-px bg-border my-1"></div>

      <!-- Specialists -->
      {#each visibleSpecialists as specialist (specialist.id)}
        <Menu.Item
          class={cn(
            'h-auto min-h-(--control-height-medium) gap-2 w-full py-2 text-left',
            value === specialist.id ? 'bg-muted/50' : '',
          )}
          onSelect={() => handleSelect(specialist.id)}
        >
          <AgentAvatar
            agentId="blank"
            variant="standard"
            specialist={specialist.id}
            icon={specialist.icon}
          />
          <div class="flex flex-col min-w-0 flex-1">
            <span class="text-foreground truncate">{specialist.name}</span>
            <span class="text-xs text-subtle truncate">{specialist.description}</span>
          </div>
        </Menu.Item>
      {/each}
    </div>
  {/snippet}
</DropdownMenu>
