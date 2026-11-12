<script lang="ts">
  import DotsThreeOutlineIcon from 'phosphor-svelte/lib/DotsThreeOutlineIcon';
  import DotsThreeOutlineVerticalIcon from 'phosphor-svelte/lib/DotsThreeOutlineVerticalIcon';

  let {
    class: className = 'size-4',
    orientation = 'vertical',
  }: {
    class?: string;
    orientation?: 'horizontal' | 'vertical';
  } = $props();

  const Glyph = $derived(
    orientation === 'horizontal' ? DotsThreeOutlineIcon : DotsThreeOutlineVerticalIcon,
  );
</script>

<Glyph size={16} weight="fill" class={className} aria-hidden="true" />
