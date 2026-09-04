<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Label } from '$lib/components/ui/label';
  import { cn } from '$lib/utils';

  let {
    id,
    label,
    description,
    htmlFor,
    error,
    status,
    disabled = false,
    busy = false,
    compact = false,
    leading,
    control,
    children,
    class: className,
  }: {
    id: string;
    label: string;
    description?: string;
    htmlFor?: string;
    error?: string;
    status?: string;
    disabled?: boolean;
    busy?: boolean;
    compact?: boolean;
    leading?: Snippet;
    control?: Snippet<
      [
        {
          labelId: string;
          descriptionId?: string;
          errorId?: string;
          disabled: boolean;
          busy: boolean;
        },
      ]
    >;
    children?: Snippet;
    class?: string;
  } = $props();

  const labelId = $derived(`${id}-label`);
  const descriptionId = $derived(description ? `${id}-description` : undefined);
  const errorId = $derived(error ? `${id}-error` : undefined);
  const orientation = $derived(compact ? 'stacked' : 'responsive');
</script>

<div
  data-slot="settings-field-row"
  data-disabled={disabled || undefined}
  data-orientation={compact ? 'stacked' : 'responsive'}
  aria-busy={busy || undefined}
  class={cn(
    'grid min-w-0 gap-3 py-3 first:pt-3 last:pb-3',
    compact
      ? 'grid-cols-1'
      : 'md:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] md:items-start md:gap-8',
    className,
  )}
>
  <div class="flex min-w-0 items-start gap-3">
    {#if leading}
      <div class="shrink-0" data-field-leading aria-hidden="true">{@render leading()}</div>
    {/if}
    <div class="min-w-0 flex-1 space-y-1 break-words">
      {#if htmlFor}
        <Label id={labelId} for={htmlFor} class={cn('block font-medium', disabled && 'opacity-60')}
          >{label}</Label
        >
      {:else}
        <div
          id={labelId}
          class={cn('type-body font-medium text-foreground', disabled && 'opacity-60')}
        >
          {label}
        </div>
      {/if}
      {#if description}
        <p
          id={descriptionId}
          class={cn('type-body text-muted-foreground', disabled && 'opacity-60')}
        >
          {description}
        </p>
      {/if}
      {#if error}
        <p id={errorId} class="type-body text-danger" role="alert">{error}</p>
      {:else if status}
        <p class={cn('type-body text-info', disabled && 'opacity-60')} role="status">
          {status}
        </p>
      {/if}
    </div>
  </div>
  <div
    class={cn('w-full min-w-0 max-w-full md:w-auto md:justify-self-end', disabled && 'opacity-60')}
    data-field-control
    data-orientation={orientation}
  >
    {#if control}
      {@render control({ labelId, descriptionId, errorId, disabled, busy })}
    {:else}
      {@render children?.()}
    {/if}
  </div>
</div>
