<script lang="ts">
  /**
   * In-app replacement toast for a suppressed frontmost OS notification,
   * carrying the workspace's micro key-slot square next to the title. Only
   * rendered when a slot resolved — the badge-less case keeps the plain
   * `toast(...)` rendering (see notification-ipc-service.showNavigateToast).
   */
  import Button from '$lib/components/ui/button/button.svelte';
  import MicroKeySlotSquare from '$lib/components/ui/toast/MicroKeySlotSquare.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  /**
   * Structured content parts of `notification:show` (mirrors the wire
   * contract in main's notification.service.ts; present only for non-chief
   * agent-idle notifications).
   */
  interface StructuredContent {
    /** Emitting agent id — seeds the deterministic auggie avatar colors. */
    agentId?: string;
    /** Untruncated workspace title (truncated here via CSS). */
    workspaceTitle?: string;
    /** Raw specialist id, e.g. "spec-writer". */
    specialist?: string;
    /** Localized specialist display name, e.g. "Coordinator". */
    specialistDisplayName: string;
    taskTitle?: string;
    /** ACP provider id (auggie, claude-code, codex, ...). */
    provider?: string;
  }

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
    /**
     * Structured parts for the three-line layout; absent (old daemon / chief)
     * falls back to the plain title/description rendering.
     */
    structured?: StructuredContent;
  }

  let { title, description, keySlot, actionLabel, onAction, structured }: Props = $props();

  let specialistLine = $derived(
    structured
      ? structured.taskTitle
        ? `${structured.specialistDisplayName}: ${structured.taskTitle}`
        : structured.specialistDisplayName
      : '',
  );
</script>

<!-- Content-only: the Sonner wrapper owns the card chrome (bg, border, padding). -->
<div class="flex items-center gap-3 max-w-[500px]">
  <div class="flex-1 min-w-0">
    {#if structured}
      <!-- Line 1: slot square baseline-aligned with the workspace title. -->
      <div class="flex items-baseline gap-1.5">
        <MicroKeySlotSquare slot={keySlot} />
        <p class="text-sm font-medium text-foreground truncate min-w-0">
          {structured.workspaceTitle ?? title}
        </p>
      </div>
      <!-- Line 2: provider-aware agent avatar + specialist (+ task title). -->
      <div class="flex items-center gap-1.5 mt-0.5">
        <AuggieAvatar
          agentId={structured.agentId}
          provider={structured.provider}
          specialist={structured.specialist}
          size={17}
        />
        <p class="text-sm text-foreground truncate min-w-0">{specialistLine}</p>
      </div>
      <!-- Line 3: body ("Finished"). -->
      {#if description}
        <p class="text-sm text-muted-foreground mt-0.5">{description}</p>
      {/if}
    {:else}
      <div class="flex items-center gap-1.5">
        <MicroKeySlotSquare slot={keySlot} />
        <p class="text-sm font-medium text-foreground">{title}</p>
      </div>
      {#if description}
        <p class="text-sm text-muted-foreground mt-0.5">{description}</p>
      {/if}
    {/if}
  </div>
  <Button variant="outline" size="sm" onclick={onAction}>
    {actionLabel}
  </Button>
</div>
