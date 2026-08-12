<script lang="ts">
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  import ProviderIcon from '$features/agent/components/AgentProviderIcon.svelte';
  import type { DropdownOption } from '$lib/components/ui/dropdown';
  import { cn } from '$lib/utils';
  import ModelProviderErrorItem from './ModelProviderErrorItem.svelte';
  import type { ProviderLoadError } from './model-picker-provider-errors';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    option: DropdownOption;
    selected: boolean;
    isDefault: boolean;
    providerId: string;
  }

  let { option, selected, isDefault, providerId }: Props = $props();

  const effortLevels = $derived(option.data?.effortLevels as string[] | undefined);
  const providerLoadError = $derived(
    option.data?.providerLoadError as ProviderLoadError | undefined,
  );
  const providerLoading = $derived(option.data?.providerLoading as boolean | undefined);
</script>

<div class="flex gap-2 w-full min-w-0">
  {#if providerLoading}
    <div class="type-body flex items-center gap-2 text-muted-foreground">
      <div
        class="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin"
      ></div>
      <span>{option.label}</span>
    </div>
  {:else if providerLoadError}
    <ModelProviderErrorItem
      providerId={providerLoadError.providerId}
      providerLabel={providerLoadError.providerName}
      error={providerLoadError.message}
      hint={providerLoadError.hint}
    />
  {:else}
    {#if !isDefault}
      <ProviderIcon {providerId} class="size-3.5 shrink-0 mt-0.5" />
    {/if}
    <div class="flex-1 min-w-0">
      <div class="flex items-baseline justify-between gap-2">
        <span
          class={cn(
            'type-body truncate font-medium',
            isDefault && 'italic text-muted-foreground',
            selected && 'font-medium',
          )}
        >
          {option.label}
        </span>
        {#if selected}
          <Fa icon={faCheck} class="h-3 w-3 shrink-0 text-primary" />
        {/if}
      </div>
      {#if option.description}
        <div class="type-caption mt-0.5 truncate text-subtle" title={option.description}>
          {option.description}
        </div>
      {/if}
      {#if effortLevels && effortLevels.length > 0}
        <div class="type-caption hidden truncate text-subtle/60">
          {m.chat_modelPicker_effort_label({ levels: effortLevels.join(' · ') })}
        </div>
      {/if}
    </div>
  {/if}
</div>
