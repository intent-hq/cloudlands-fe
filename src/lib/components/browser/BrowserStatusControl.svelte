<script lang="ts">
  import { tick } from 'svelte';
  import Fa from 'svelte-fa';
  import {
    faDesktop,
    faCircleExclamation,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Popover from '$lib/components/ui/popover';

  let {
    label,
    description,
    ariaLabel = label,
    tone = 'info',
    actionLabel,
    onAction,
    actionFocusTarget,
  }: {
    label: string;
    description: string;
    ariaLabel?: string;
    tone?: 'info' | 'warning' | 'error';
    actionLabel?: string;
    onAction?: () => void;
    actionFocusTarget?: HTMLElement | null;
  } = $props();

  let open = $state(false);
  let actionSelected = false;
  const descriptionId = $props.id();

  async function runAction() {
    actionSelected = true;
    open = false;
    await tick();
    actionFocusTarget?.focus();
    onAction?.();
  }
</script>

<span class="inline-flex shrink-0" data-browser-status={tone}>
  <span id={descriptionId} class="sr-only" role={tone === 'error' ? 'alert' : 'status'}>
    {description}
  </span>
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="sm"
          wrapContent={false}
          class="h-7 min-w-7 max-w-40 gap-1.5 px-1.5 {tone === 'error'
            ? 'text-danger'
            : tone === 'warning'
              ? 'text-warning-ink'
              : 'text-muted-foreground'}"
          aria-label={ariaLabel}
          aria-describedby={descriptionId}
          tooltip={description}
          tooltipDisabled={open}
          tooltipSide="bottom"
        >
          <Fa
            icon={tone === 'error'
              ? faCircleExclamation
              : tone === 'warning'
                ? faTriangleExclamation
                : faDesktop}
            size="xs"
            class="shrink-0"
          />
          <span class="browser-status-label min-w-0 truncate">{label}</span>
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content
      align="end"
      class="flex max-h-[var(--bits-popover-content-available-height,calc(100dvh-1rem))] w-72 max-w-[calc(100vw-1rem)] flex-col gap-3 p-3"
      aria-label={ariaLabel}
      onCloseAutoFocus={(event) => {
        if (actionSelected && actionFocusTarget) {
          event.preventDefault();
          actionFocusTarget.focus();
        }
        actionSelected = false;
      }}
    >
      <p class="min-h-0 overflow-y-auto text-sm text-foreground [overflow-wrap:anywhere]">
        {description}
      </p>
      {#if actionLabel && onAction}
        <Button variant="secondary" size="sm" class="self-start" onclick={() => void runAction()}
          >{actionLabel}</Button
        >
      {/if}
    </Popover.Content>
  </Popover.Root>
</span>

<style>
  @container browser-toolbar (max-width: 480px) {
    .browser-status-label {
      display: none;
    }
  }
</style>
