<script lang="ts">
  import { discussionReactionAsset } from './discussion-reactions';
  let { emoji, size = 15 }: { emoji: string; size?: 13 | 15 | 20 } = $props();
  const asset = $derived(discussionReactionAsset(emoji));
</script>

{#if asset}
  <img
    src={asset}
    alt=""
    width={size}
    height={size}
    class="pointer-events-none shrink-0 object-contain"
    style:width={`${size}px`}
    style:height={`${size}px`}
    data-discussion-emoji={emoji}
  />
{:else}
  <span aria-hidden="true" class="shrink-0 leading-none" style:font-size={`${size}px`}>{emoji}</span
  >
{/if}
