<script lang="ts">
  interface Props {
    class?: string;
    children?: import('svelte').Snippet;
  }

  let { class: className = '', children }: Props = $props();
</script>

<div class="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit {className}">
  {@render children?.()}
</div>
