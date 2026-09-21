<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Label } from '$lib/components/ui/label';
  import { cn } from '$lib/utils';

  let {
    id,
    label,
    description,
    htmlFor,
    activateLabel = false,
    error,
    status,
    statusTone = 'info',
    disabled = false,
    busy = false,
    compact = false,
    searchText = label,
    danger = false,
    experimental = false,
    featureCode,
    controlOnly = false,
    leading,
    descriptionContent,
    control,
    children,
    class: className,
  }: {
    id: string;
    label: string;
    description?: string;
    htmlFor?: string;
    /** Forward label activation to composite controls that ignore native label clicks. */
    activateLabel?: boolean;
    error?: string;
    status?: string;
    statusTone?: 'info' | 'subtle';
    disabled?: boolean;
    busy?: boolean;
    compact?: boolean;
    searchText?: string;
    danger?: boolean;
    experimental?: boolean;
    featureCode?: string;
    controlOnly?: boolean;
    leading?: Snippet;
    descriptionContent?: Snippet;
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
  const descriptionId = $derived(
    description || descriptionContent ? `${id}-description` : undefined,
  );
  const errorId = $derived(error ? `${id}-error` : undefined);
  const orientation = $derived(controlOnly ? 'full-width' : compact ? 'stacked' : 'responsive');

  function handleLabelClick(event: MouseEvent) {
    if (!activateLabel || !htmlFor) return;
    // Suppress the browser's additional label-forwarded click. The canonical
    // select accepts synthetic clicks, while pointer activation belongs to it.
    event.preventDefault();
    if (disabled || busy) return;
    const target = event.currentTarget as HTMLLabelElement;
    const control = target.ownerDocument.getElementById(htmlFor);
    control?.focus();
    control?.click();
  }
</script>

<div
  {id}
  data-slot="settings-field-row"
  data-highlight-id={id}
  data-settings-search-text={searchText}
  data-settings-feature-code={featureCode}
  data-danger={danger || undefined}
  data-experimental={experimental || undefined}
  data-disabled={disabled || undefined}
  data-orientation={orientation}
  aria-busy={busy || undefined}
  class={cn(
    'grid min-w-0 gap-3 py-3 first:pt-3 last:pb-3',
    controlOnly
      ? 'grid-cols-1'
      : compact
        ? 'grid-cols-1'
        : 'md:grid-cols-[minmax(0,1fr)_minmax(12rem,auto)] md:items-start md:gap-8',
    className,
  )}
>
  {#if !controlOnly}
    <div class="flex min-w-0 items-start gap-3">
      {#if leading}<div class="shrink-0" data-field-leading aria-hidden="true">
          {@render leading()}
        </div>{/if}
      <div class="min-w-0 flex-1 space-y-1 break-words">
        {#if htmlFor}
          <Label
            id={labelId}
            data-field-label
            for={htmlFor}
            onclick={activateLabel ? handleLabelClick : undefined}
            class={cn(
              'type-body block font-medium text-foreground',
              activateLabel && !disabled && !busy && 'cursor-pointer',
              !compact && 'md:py-[max(0px,calc((var(--control-height-medium)-1lh)/2))]',
            )}
          >
            {label}
          </Label>
        {:else}
          <div
            id={labelId}
            data-field-label
            class={cn(
              'type-body font-medium text-foreground',
              !compact && 'md:py-[max(0px,calc((var(--control-height-medium)-1lh)/2))]',
            )}
          >
            {label}
          </div>
        {/if}
        {#if description || descriptionContent}<p
            id={descriptionId}
            class="type-body text-muted-foreground"
          >
            {#if descriptionContent}
              {@render descriptionContent()}
            {:else}
              {description}
            {/if}
          </p>{/if}
        {#if error}
          <p id={errorId} class="type-body text-danger" role="alert">{error}</p>
        {:else if status}
          <p
            class={cn('type-body', statusTone === 'subtle' ? 'text-ghost' : 'text-info')}
            role="status"
          >
            {status}
          </p>
        {/if}
      </div>
    </div>
  {/if}
  <div
    class={cn(
      'w-full min-w-0 max-w-full',
      !controlOnly &&
        !compact &&
        'md:grid md:min-h-(--control-height-medium) md:content-center md:justify-items-end',
      controlOnly || compact ? 'md:justify-self-stretch' : 'md:w-auto md:justify-self-end',
      disabled && 'opacity-60',
    )}
    data-field-control
    data-orientation={orientation}
  >
    {#if control}{@render control({
        labelId,
        descriptionId,
        errorId,
        disabled,
        busy,
      })}{:else}{@render children?.()}{/if}
  </div>
</div>

<style>
  /* A roomy viewport can still contain a narrow settings pane. Explicit compact
     rows and full-width custom bodies keep their independent layout contract. */
  @container settings-form (width < 32rem) {
    [data-slot='settings-field-row'][data-orientation='responsive'] {
      grid-template-columns: minmax(0, 1fr);
      gap: var(--space-3);
    }

    [data-orientation='responsive'] :global([data-field-label]) {
      padding-block: 0;
    }

    [data-field-control][data-orientation='responsive'] {
      width: 100%;
      min-height: 0;
      justify-self: stretch;
      justify-items: start;
    }
  }
</style>
