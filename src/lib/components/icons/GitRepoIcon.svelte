<script lang="ts">
  import BookBookmarkIcon from 'phosphor-svelte/lib/BookBookmarkIcon';

  interface Props {
    size?: number;
    class?: string;
  }

  let { size = 16, class: className = '' }: Props = $props();
</script>

<BookBookmarkIcon {size} weight="regular" class={className} aria-hidden="true" />
