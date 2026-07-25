<script lang="ts">
  import Fa from 'svelte-fa';
  import {
  faGear,
  faChevronDown,
  faPlus,
} from '@fortawesome/free-solid-svg-icons';
  import { cn } from '$lib/utils';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import type { Specialist } from '$lib/constants/specialists';
  import {
  selectSpecialists,
  selectUserOverrides,
  filterPickableSpecialists,
} from '$store/renderer/slices/specialists/specialists-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import type { AgentSession } from '$shared/types/agent-session';
  import { isPendingAgentSession } from '$shared/types/agent-session';
  import AuggieAvatar from '../ui/auggie-avatar/AuggieAvatar.svelte';
  import DropdownMenu from '../ui/dropdown-menu.svelte';
  import Button from '../ui/button/button.svelte';

  interface Props {
    onSpecialistChange?: (specialistId: string | null) => void;
    session?: AgentSession | null;
  }

  let { onSpecialistChange, session }: Props = $props();

  // Reactive store subscriptions for Svelte reactivity
  const specialists$ = selectSpecialists();
  const userOverrides$ = selectUserOverrides();
  $effect(() => { void $userOverrides$; });

  // Get specialist info from session metadata
  const specialistInfo = $derived.by((): Specialist | null => {
    if (!session || isPendingAgentSession(session)) return null;
    const specialistId = session.metadata?.specialist || session.agentMetadata?.specialist;
    if (!specialistId) return null;
    return $specialists$.find((s) => s.id === specialistId) || null;
  });

  // Navigate to settings with specialist expanded
  async function openSpecialistSettings(specialistId?: string) {
    if (specialistId) {
      await navigateToSettings({ specialist: specialistId, hash: 'specialists' });
    } else {
      await navigateToSettings({ view: 'create-specialist' });
    }
  }

  // State for show more/less behavior prompt
  let showFullPrompt = $state(false);

  // Only hide the core team-mode specialists from the picker
  const builtInSpecialists = ['spec-writer', 'implementor', 'verifier'];
  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const customSpecialists = $derived(
    filterPickableSpecialists($specialists$, $isGitHubAuth$).filter(
      (s) => !builtInSpecialists.includes(s.id),
    ),
  );

  // Dropdown state for the specialist picker
  let pickerOpen = $state(false);

  // General agent description shown when no specialist is selected
  const generalDescription = 'This agent has full workspace context. Ask me anything about your code or what you\'d like to work on.';

  // Display label for the picker trigger
  const displayLabel = $derived(specialistInfo?.name ?? 'General');

  // The behavior prompt or description to show
  const displayPrompt = $derived(
    specialistInfo ? (specialistInfo.defaultBehaviorPrompt || '') : generalDescription,
  );
</script>

<div class="flex flex-col flex-1 text-subtle py-6 pt-4 px-4">
  <!-- Specialist Picker Dropdown -->
  {#if onSpecialistChange}
    <div class="mb-4">
      <DropdownMenu bind:open={pickerOpen} align="start" side="bottom" contentClass="p-0!">
        {#snippet trigger({ toggle }: { toggle: () => void })}
          <button
            type="button"
            onclick={toggle}
            class={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 text-sm',
              'bg-sidebar/50 cursor-pointer',
            )}
          >
            <AuggieAvatar seed="blank" size={18} specialist={specialistInfo?.id ?? null} />
            <span class="text-foreground font-medium">{displayLabel}</span>
            <Fa icon={faChevronDown} class="text-ghost" size={10} />
          </button>
        {/snippet}

        {#snippet content({ close }: { close: () => void })}
          <div class="min-w-[220px]">
            <!-- General option -->
            <button
              type="button"
              class={cn(
                'flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-muted rounded-sm cursor-pointer',
                !specialistInfo ? 'bg-muted/50' : '',
              )}
              onclick={() => { onSpecialistChange?.(null); close(); }}
            >
              <AuggieAvatar seed="blank" size={20} />
              <div class="flex flex-col min-w-0">
                <span class="font-medium text-foreground">General</span>
                <span class="text-xs text-subtle">No specialized behavior</span>
              </div>
            </button>

            {#if customSpecialists.length > 0}
              <div class="h-px bg-border"></div>
            {/if}

            <!-- Specialists -->
            {#each customSpecialists as specialist (specialist.id)}
              <button
                type="button"
                class={cn(
                  'flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors',
                  'hover:bg-muted rounded-sm cursor-pointer',
                  specialistInfo?.id === specialist.id ? 'bg-muted/50' : '',
                )}
                onclick={() => { onSpecialistChange?.(specialist.id); close(); }}
              >
                <AuggieAvatar seed="blank" size={20} specialist={specialist.id} />
                <div class="flex flex-col min-w-0">
                  <span class="font-medium text-foreground">{specialist.name}</span>
                  <span class="text-xs text-subtle truncate">{specialist.description}</span>
                </div>
              </button>
            {/each}

            <!-- Create new -->
            <div class="h-px bg-border"></div>
            <button
              type="button"
              class="flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-sm cursor-pointer transition-colors"
              onclick={() => { openSpecialistSettings(); close(); }}
            >
              <Fa icon={faPlus} size={12} class="ml-1 opacity-50" />
              <span>Create specialist</span>
            </button>
          </div>
        {/snippet}
      </DropdownMenu>
    </div>
  {/if}

  <!-- Behavior Prompt / Description -->
  <div class="bg-muted/20 px-4 py-2.5 mb-3">
    <p
      class="text-sm text-subtle leading-relaxed whitespace-pre-wrap {specialistInfo && !showFullPrompt
        ? 'line-clamp-6'
        : ''}"
    >
      {displayPrompt}
    </p>
    {#if specialistInfo}
      <button
        type="button"
        onclick={() => (showFullPrompt = !showFullPrompt)}
        class="text-xs text-muted-foreground hover:text-foreground transition-colors mt-2 cursor-pointer"
      >
        {showFullPrompt ? 'Show less' : 'Show more'}
      </button>
    {/if}
  </div>

  <!-- Source Label -->
  {#if specialistInfo?.source}
    <p class="text-xs text-muted-foreground mb-2">
      {#if specialistInfo.source === 'project'}
        📁 Project specialist
      {:else if specialistInfo.source === 'user'}
        👤 User specialist
      {:else if specialistInfo.source === 'bundled'}
        📦 Built-in specialist
      {/if}
    </p>
  {/if}

  <!-- Customize Button (only for specialists) -->
  {#if specialistInfo}
    <Button
      variant="ghost-light"
      size="sm"
      onclick={() => openSpecialistSettings(specialistInfo.id)}
      class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer pl-1.5 mr-auto"
    >
      <Fa icon={faGear} size={12} class="opacity-60" />
      <span>Customize this specialist's behavior</span>
    </Button>
  {/if}
</div>
