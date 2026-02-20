<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  interface Props {
    agentId: string;
    agentName: string;
    onUndo: () => void;
  }

  let { agentId, agentName, onUndo }: Props = $props();

  const dispatch = createEventDispatcher();

  function handleUndo() {
    onUndo();
    dispatch('closeToast');
  }

  function handleDismiss() {
    dispatch('closeToast');
  }
</script>

<div class="flex items-center gap-3 py-4 px-5 bg-card border border-border shadow-lg min-w-[360px]">
  <!-- Agent avatar -->
  <div class="flex-shrink-0">
    <AuggieAvatar faceSeed={agentId} colorSeed={agentId} size={32} />
  </div>

  <!-- Message -->
  <div class="flex-1 min-w-0">
    <p class="text-sm font-medium text-foreground truncate">
      {agentName ? `"${agentName}" deleted` : 'Agent deleted'}
    </p>
  </div>

  <!-- Undo button - styled to match sonner toast action buttons (small, inverted) -->
  <button type="button" class="undo-button" onclick={handleUndo}> Undo </button>

  <!-- Close button -->
  <button
    type="button"
    class="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
    onclick={handleDismiss}
    aria-label="Close"
  >
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"
      ></path>
    </svg>
  </button>
</div>

<style>
  .undo-button {
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.25rem 0.5rem;
    border-radius: 0;
    transition: all 0.15s ease;
    border: none;
    background: hsl(var(--foreground));
    color: hsl(var(--background));
    cursor: pointer;
    flex-shrink: 0;
  }

  .undo-button:hover {
    background: hsl(var(--foreground) / 0.8);
  }
</style>
