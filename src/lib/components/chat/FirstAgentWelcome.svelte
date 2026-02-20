<script lang="ts">
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';

  interface Props {
    agentId?: string | null;
  }

  let { agentId }: Props = $props();
</script>

<div class="flex flex-col justify-center text-left text-muted-foreground py-6 pt-3">
  <div class="mb-4">
    <AuggieAvatar faceSeed={agentId || ''} colorSeed={agentId || ''} size={32} />
  </div>

  <!-- Initial Prompt Section -->
  <p class="text-muted-foreground mb-3">Tell me a bit about what you want to work on.</p>
</div>
