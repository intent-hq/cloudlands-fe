<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { crispOut, springIn } from '$lib/motion';
  import { Button } from '$lib/components/ui/button';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { cn } from '$lib/utils.js';
  import { m } from '$shared/paraglide/messages.js';

  type CopyStatus = 'idle' | 'copied' | 'error';
  type CopyInputVariant = 'icon' | 'button';
  type CopyInputAlign = 'right' | 'left';

  const uid = $props.id();
  const contextSize = useSize();

  let {
    value,
    label,
    disabled = false,
    variant = 'icon',
    align = 'right',
    size,
    onCopy,
    class: className,
    ...restProps
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'aria-label'> & {
    value: string;
    label?: string;
    disabled?: boolean;
    variant?: CopyInputVariant;
    align?: CopyInputAlign;
    size?: UiSize;
    onCopy?: () => void;
  } = $props();

  const buttonId = `${uid}-button`;
  const labelId = `${uid}-label`;
  const resolvedSize = $derived(size ?? contextSize);
  const rowPadding = $derived(resolvedSize === 'compact' ? 'py-1' : 'py-2');
  let status = $state<CopyStatus>('idle');
  let copyCount = $state(0);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;
  let tooltipOpen = $state(false);
  let tooltipState = $state<'idle' | 'copied' | 'suppressed'>('idle');
  let tooltipWasVisible = false;

  const idleLabel = $derived(
    label ? m.ui_copyButton_label() : m.ui_copyInput_copyToClipboard_ariaLabel(),
  );
  const statusLabel = $derived(
    status === 'copied'
      ? m.ui_copyInput_copied_label()
      : status === 'error'
        ? m.ui_copyInput_copyFailed_ariaLabel()
        : idleLabel,
  );
  const actionLabel = $derived(
    status === 'copied'
      ? m.ui_copyInput_copied_label()
      : status === 'error'
        ? m.ui_copyInput_failed_label()
        : m.ui_copyButton_label(),
  );
  const resolvedTooltipOpen = $derived(
    tooltipState === 'copied' ? true : tooltipState === 'suppressed' ? false : tooltipOpen,
  );

  function copyViaExecCommand(): boolean {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  async function handleCopy() {
    if (disabled) return;
    let copied = true;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else copied = copyViaExecCommand();
    } catch {
      copied = copyViaExecCommand();
    }

    status = copied ? 'copied' : 'error';
    copyCount += 1;
    tooltipState = tooltipWasVisible ? 'copied' : 'suppressed';
    tooltipOpen = tooltipWasVisible;
    if (copied) onCopy?.();
    if (copyTimeout) clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      status = 'idle';
      tooltipState = 'suppressed';
      tooltipOpen = false;
    }, 2000);
  }

  function handlePointerDown() {
    tooltipWasVisible = tooltipOpen;
  }

  function handleTooltipOpenChange(open: boolean) {
    if (tooltipState === 'idle') tooltipOpen = open;
  }

  function handleMouseEnter() {
    if (tooltipState === 'suppressed') tooltipState = 'idle';
  }

  function handleMouseLeave() {
    if (tooltipState === 'copied') tooltipState = 'suppressed';
    tooltipOpen = false;
  }

  onDestroy(() => {
    if (copyTimeout) clearTimeout(copyTimeout);
  });
</script>

{#snippet feedbackIcon()}
  {#if status === 'idle'}
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5"></rect>
      <path
        d="M9.5 4.5V3.25A1.75 1.75 0 0 0 7.75 1.5h-4.5A1.75 1.75 0 0 0 1.5 3.25v4.5A1.75 1.75 0 0 0 3.25 9.5H4.5"
      ></path>
    </svg>
  {:else if status === 'copied'}
    <svg width="14" height="14" viewBox="2 4 20 16" fill="none" aria-hidden="true">
      <path class="copy-input-draw" pathLength="1" stroke-dasharray="1" d="M6 12L10 16L18 8"></path>
    </svg>
  {:else}
    <svg width="14" height="14" viewBox="2 4 20 16" fill="none" aria-hidden="true">
      <path class="copy-input-draw" pathLength="1" stroke-dasharray="1" d="M9 9L15 15M15 9L9 15"
      ></path>
    </svg>
  {/if}
{/snippet}

{#snippet action()}
  <span
    data-slot="copy-input-action"
    class={cn(
      'flex shrink-0 items-center px-1.5 text-muted-foreground transition-colors duration-spring-fast ease-spring-fast group-hover:text-foreground motion-reduce:transition-none',
      rowPadding,
    )}
  >
    {#key `${status}-${copyCount}`}
      <span
        data-slot="copy-input-feedback"
        class={cn(
          'flex items-center justify-center gap-1.5 [&_svg]:shrink-0 [&_svg]:stroke-current [&_svg]:stroke-[1.5] [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:transition-[stroke-width] [&_svg]:duration-spring-fast group-hover:[&_svg]:stroke-2 motion-reduce:[&_svg]:transition-none',
          status === 'error' && 'text-danger',
        )}
        in:springIn={{ tier: 'fast', y: 0, scale: status === 'idle' ? 0.8 : 0.6 }}
        out:crispOut={{ tier: 'fast', scale: 0.8 }}
      >
        {@render feedbackIcon()}
        {#if variant === 'button'}
          <span class="inline-grid select-none text-left">
            <span class="invisible col-start-1 row-start-1" aria-hidden="true">
              {m.ui_copyInput_copied_label()}
            </span>
            <span data-slot="copy-input-action-label" class="col-start-1 row-start-1">
              {actionLabel}
            </span>
          </span>
        {/if}
      </span>
    {/key}
  </span>
{/snippet}

{#snippet valueContent()}
  <span
    data-slot="copy-input-value"
    class={cn(
      'min-w-0 flex-1 select-none truncate text-left font-mono text-foreground',
      rowPadding,
      align === 'left' ? 'pl-1' : 'pl-0',
    )}
  >
    <mark
      class="bg-transparent text-foreground transition-colors duration-spring-fast ease-spring-fast group-hover:bg-focus-ring/20 group-hover:text-foreground motion-reduce:transition-none"
    >
      {value}
    </mark>
  </span>
{/snippet}

{#snippet copyButton()}
  <Button
    id={buttonId}
    type="button"
    variant="plain"
    size={resolvedSize}
    truncateLabel={false}
    labelClass="flex! w-full items-center"
    data-slot="copy-input-button"
    data-size={resolvedSize}
    style="line-height: 1.25rem"
    class="group h-auto! w-full justify-start rounded-(--radius-medium) border-0 bg-transparent p-0 text-sm font-normal leading-5 transition-colors duration-spring-fast ease-spring-fast motion-reduce:transition-none"
    {disabled}
    aria-label={statusLabel}
    aria-labelledby={label ? `${buttonId} ${labelId}` : undefined}
    onpointerdown={handlePointerDown}
    onclick={handleCopy}
  >
    {#if align === 'left'}
      {@render action()}
      {@render valueContent()}
    {:else}
      {@render valueContent()}
      {@render action()}
    {/if}
  </Button>
{/snippet}

<div
  data-slot="copy-input-field"
  data-disabled={disabled || undefined}
  class={cn('flex flex-col gap-0.5', disabled && 'pointer-events-none opacity-50', className)}
  onmouseenter={handleMouseEnter}
  onmouseleave={handleMouseLeave}
  {...restProps}
>
  {#if label}
    <span
      id={labelId}
      data-slot="copy-input-label"
      class={cn('type-caption text-muted-foreground', align === 'left' ? 'pl-1' : 'pl-0')}
    >
      {label}
    </span>
  {/if}
  {#if variant === 'icon'}
    <Tooltip
      content={statusLabel}
      delayDuration={500}
      sideOffset={2}
      {disabled}
      open={resolvedTooltipOpen}
      onOpenChange={handleTooltipOpenChange}
      class="w-full"
    >
      {@render copyButton()}
    </Tooltip>
  {:else}
    {@render copyButton()}
  {/if}
</div>

<style>
  .copy-input-draw {
    stroke-dashoffset: 1;
    animation: copy-input-draw var(--spring-fast) ease-out forwards;
  }

  @keyframes copy-input-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .copy-input-draw {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>
