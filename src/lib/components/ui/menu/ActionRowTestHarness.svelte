<script lang="ts">
  import { ActionRow } from '$lib/components/ui/menu';
  import { ShortcutChip } from '$lib/components/ui/kbd';
  let { onActivate = () => {} }: { onActivate?: () => void } = $props();
</script>

<div class="w-full max-w-140 p-1">
  <ActionRow onclick={onActivate}>
    {#snippet title()}Short action{/snippet}
  </ActionRow>
  <ActionRow onclick={onActivate} selected>
    {#snippet leading()}<span aria-hidden="true">+</span>{/snippet}
    {#snippet title()}Review accessible keyboard navigation and multiline command results{/snippet}
    {#snippet description()}
      A deliberately long description wraps naturally without covering the following row, while the
      icon and keyboard shortcut remain inside the same hit target.
    {/snippet}
    {#snippet trailing()}<ShortcutChip>⌘K</ShortcutChip>{/snippet}
  </ActionRow>
  <ActionRow disabled onclick={onActivate}>
    {#snippet title()}Unavailable action{/snippet}
  </ActionRow>
  <ActionRow onclick={onActivate}>
    {#snippet title()}Following action{/snippet}
  </ActionRow>
</div>
