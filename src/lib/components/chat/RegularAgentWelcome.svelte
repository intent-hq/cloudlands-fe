<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCheck, faGear, faChevronDown, faPlus } from '@fortawesome/free-solid-svg-icons';
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
  import AgentAvatar from '$features/agent/components/agent-avatar/AgentAvatar.svelte';
  import DropdownMenu from '../ui/dropdown-menu.svelte';
  import Button from '../ui/button/button.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    onSpecialistChange?: (specialistId: string | null) => void;
    session?: AgentSession | null;
  }

  let { onSpecialistChange, session }: Props = $props();

  // Reactive store subscriptions for Svelte reactivity
  const specialists$ = selectSpecialists();
  const userOverrides$ = selectUserOverrides();
  $effect(() => {
    void $userOverrides$;
  });

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

  const isGitHubAuth$ = selectGitHubAuthIsAuthenticated();
  const customSpecialists = $derived(filterPickableSpecialists($specialists$, $isGitHubAuth$));

  // Dropdown state for the specialist picker
  let pickerOpen = $state(false);

  // General agent description shown when no specialist is selected
  const generalDescription = $derived(m.chat_regularAgentWelcome_generalDescription_label());

  // Display label for the picker trigger
  const displayLabel = $derived(specialistInfo?.name ?? m.chat_shared_general_fallback());
  const displayDescription = $derived(
    specialistInfo?.description ?? m.chat_shared_noSpecializedBehavior_label(),
  );

  // The behavior prompt or description to show
  const displayPrompt = $derived(
    specialistInfo ? specialistInfo.defaultBehaviorPrompt || '' : generalDescription,
  );
</script>

<div class="mx-auto flex w-full max-w-[40rem] flex-1 flex-col px-4 pb-6 pt-4 text-subtle">
  <!-- Specialist Picker Dropdown -->
  {#if onSpecialistChange}
    <div class="mb-5">
      <DropdownMenu
        class="block w-full"
        bind:open={pickerOpen}
        align="start"
        side="bottom"
        contentClass="w-[min(28rem,calc(100vw-2rem))] overflow-hidden p-0!"
      >
        {#snippet trigger({ props })}
          <button
            {...props}
            type="button"
            class={cn(
              'group flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left shadow-xs transition-colors',
              'hover:border-input hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            data-testid="specialist-picker-trigger"
          >
            <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted/50">
              <AgentAvatar
                agentId="blank"
                variant="emphasized"
                specialist={specialistInfo?.id ?? null}
                icon={specialistInfo?.icon ?? null}
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="type-body truncate font-medium text-foreground">{displayLabel}</div>
              <div class="type-caption mt-0.5 line-clamp-2 text-muted-foreground">
                {displayDescription}
              </div>
            </div>
            <div
              class="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/50 text-muted-foreground transition-colors group-hover:bg-muted"
            >
              <Fa icon={faChevronDown} size={10} />
            </div>
          </button>
        {/snippet}

        {#snippet content({ close }: { close: () => void })}
          <div>
            <div class="border-b border-border bg-muted/20 px-4 py-3">
              <p class="type-body font-medium text-foreground">
                {m.workspace_createAgentSection_specialists_label()}
              </p>
              <p class="type-caption mt-0.5 text-muted-foreground">
                {m.workspace_createAgentSection_specialists_label()}
                {m.workspace_createAgentSection_specialists_description()}
              </p>
            </div>

            <div class="max-h-[21rem] overflow-y-auto p-2">
              <button
                type="button"
                class={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                  'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !specialistInfo ? 'bg-accent/70' : '',
                )}
                aria-pressed={!specialistInfo}
                data-specialist-option="general"
                onclick={() => {
                  onSpecialistChange?.(null);
                  close();
                }}
              >
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/50"
                >
                  <AgentAvatar agentId="blank" size={22} />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="type-body font-medium text-foreground">
                    {m.chat_shared_general_fallback()}
                  </div>
                  <div class="type-caption mt-0.5 text-muted-foreground">
                    {m.chat_shared_noSpecializedBehavior_label()}
                  </div>
                </div>
                {#if !specialistInfo}
                  <Fa icon={faCheck} size={12} class="shrink-0 text-primary" />
                {/if}
              </button>

              {#each customSpecialists as specialist (specialist.id)}
                <button
                  type="button"
                  class={cn(
                    'mt-1 flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
                    'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    specialistInfo?.id === specialist.id ? 'bg-accent/70' : '',
                  )}
                  aria-pressed={specialistInfo?.id === specialist.id}
                  data-specialist-option={specialist.id}
                  onclick={() => {
                    onSpecialistChange?.(specialist.id);
                    close();
                  }}
                >
                  <div
                    class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/50"
                  >
                    <AgentAvatar
                      agentId="blank"
                      size={22}
                      specialist={specialist.id}
                      icon={specialist.icon}
                    />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="type-body font-medium text-foreground">{specialist.name}</div>
                    <div class="type-caption mt-0.5 line-clamp-2 text-muted-foreground">
                      {specialist.description}
                    </div>
                  </div>
                  {#if specialistInfo?.id === specialist.id}
                    <Fa icon={faCheck} size={12} class="shrink-0 text-primary" />
                  {/if}
                </button>
              {/each}
            </div>

            <div class="border-t border-border bg-popover p-2">
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => {
                  openSpecialistSettings();
                  close();
                }}
              >
                <div
                  class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/50"
                >
                  <Fa icon={faPlus} size={12} />
                </div>
                <span class="type-body font-medium"
                  >{m.chat_regularAgentWelcome_createSpecialist_label()}</span
                >
              </button>
            </div>
          </div>
        {/snippet}
      </DropdownMenu>
    </div>
  {/if}

  <!-- Behavior Prompt / Description -->
  <div class="mb-3 px-4" data-testid="agent-welcome-description">
    <p
      class="text-sm text-subtle leading-relaxed whitespace-pre-wrap {specialistInfo &&
      !showFullPrompt
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
        {showFullPrompt
          ? m.chat_regularAgentWelcome_showLess_label()
          : m.chat_regularAgentWelcome_showMore_label()}
      </button>
    {/if}
  </div>

  <!-- Source Label -->
  {#if specialistInfo?.source}
    <p class="text-xs text-muted-foreground mb-2">
      {#if specialistInfo.source === 'project'}
        {m.chat_regularAgentWelcome_projectSpecialist_label()}
      {:else if specialistInfo.source === 'user'}
        {m.chat_regularAgentWelcome_userSpecialist_label()}
      {:else if specialistInfo.source === 'bundled'}
        {m.chat_regularAgentWelcome_builtInSpecialist_label()}
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
      <span>{m.chat_regularAgentWelcome_customize_label()}</span>
    </Button>
  {/if}
</div>
