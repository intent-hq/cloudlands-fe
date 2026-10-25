<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import MicroKeySlotSquare from '$features/hardware-console/components/MicroKeySlotSquare.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import ToastCloseButton from './ToastCloseButton.svelte';
  import ToastGlyph from './ToastGlyph.svelte';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Who finished, e.g. "Implementor finished" (Assistant: the chat title). */
    title: string;
    /** Workspace the agent finished in (absent for the Assistant). */
    workspaceTitle?: string;
    /** Task title, or the generic "Finished" / "Task completed" line. */
    description?: string;
    /** ISO timestamp when the agent went idle — renders a live "X ago". */
    timestamp?: string;
    /** Resolved 0-based micro key slot of the workspace (badge hidden when null). */
    keySlot?: number | null;
    onSwitchTo: () => void;
    onClose: () => void;
  }

  let {
    title,
    workspaceTitle,
    description,
    timestamp,
    keySlot = null,
    onSwitchTo,
    onClose,
  }: Props = $props();
</script>

<!-- Content-only: the Sonner wrapper owns the shared card chrome (bg, neutral border, padding). -->
<div class="relative flex w-full min-w-0 items-start gap-2.5 pr-6" data-toast-layout="agent-idle">
  <span class="first-line-icon toast-first-line"><ToastGlyph variant="success" /></span>

  <div class="flex-1 min-w-0">
    <div class="flex items-start gap-1.5">
      {#if keySlot != null}
        <span class="first-line-icon toast-first-line"><MicroKeySlotSquare slot={keySlot} /></span>
      {/if}
      <p class="toast-title flex min-w-0 items-baseline">
        <span class="min-w-0 truncate" data-toast-title {title}>{title}</span>
        {#if timestamp}
          <RelativeTime
            date={timestamp}
            compact={true}
            class="ml-1 shrink-0 whitespace-nowrap text-xs font-normal text-muted-foreground"
          />
        {/if}
      </p>
    </div>
    {#if workspaceTitle}
      <p class="toast-workspace truncate" data-toast-workspace title={workspaceTitle}>
        {workspaceTitle}
      </p>
    {/if}
    {#if description}
      <p class="toast-description" data-toast-description>{description}</p>
    {/if}

    <div class="toast-actions">
      <Button variant="primary" size="compact" class="toast-action" onclick={onSwitchTo}>
        {m.notifications_idleToast_switchTo_label()}
      </Button>
    </div>
  </div>

  <ToastCloseButton onclick={onClose} ariaLabel={m.notifications_idleToast_close_ariaLabel()} />
</div>

<style>
  .toast-title,
  .toast-first-line {
    color: hsl(var(--foreground));
    font-size: var(--toast-title-size, 0.8125rem);
    font-weight: 500;
    line-height: 1.4;
  }

  .toast-workspace {
    margin-top: 0.125rem;
    color: hsl(var(--foreground));
    font-size: var(--toast-description-size, 0.8125rem);
    line-height: 1.4;
  }

  .toast-description {
    margin-top: 0.125rem;
    color: hsl(var(--muted-foreground));
    font-size: var(--toast-description-size, 0.8125rem);
    font-weight: 400;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .toast-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: 0.75rem;
  }

  :global(.toast-action) {
    min-height: var(--toast-action-height, var(--control-height-compact));
    border-radius: var(--toast-action-radius, var(--radius));
  }

  :global(.toast-action:focus-visible) {
    outline: 1px solid hsl(var(--focus-ring));
    outline-offset: 2px;
    box-shadow: none;
  }
</style>
