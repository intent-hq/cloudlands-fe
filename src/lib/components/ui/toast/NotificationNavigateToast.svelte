<script lang="ts">
  /**
   * In-app replacement toast for a suppressed frontmost OS notification,
   * carrying the workspace's micro key-slot square next to the title. Only
   * rendered when a slot resolved — the badge-less case keeps the plain
   * `toast(...)` rendering (see notification-ipc-service.showNavigateToast).
   */
  import Button from '$lib/components/ui/button/button.svelte';
  import MicroKeySlotSquare from '$lib/components/ui/toast/MicroKeySlotSquare.svelte';

  interface Props {
    /** Notification title (falls back to the body upstream). */
    title: string;
    /** Notification body shown under the title. */
    description?: string;
    /** Resolved 0-based micro key slot of the workspace. */
    keySlot: number;
    /** "Open" action label. */
    actionLabel: string;
    onAction: () => void;
  }

  let { title, description, keySlot, actionLabel, onAction }: Props = $props();
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding). -->
<div class="flex items-center gap-3 max-w-[500px]">
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-1.5">
      <MicroKeySlotSquare slot={keySlot} />
      <p class="text-sm font-medium text-foreground">{title}</p>
    </div>
    {#if description}
      <p class="text-sm text-muted-foreground mt-0.5">{description}</p>
    {/if}
  </div>
  <Button variant="outline" size="sm" onclick={onAction}>
    {actionLabel}
  </Button>
</div>
