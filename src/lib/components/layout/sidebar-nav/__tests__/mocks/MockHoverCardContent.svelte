<script lang="ts">
  interface Props {
    expanded?: boolean;
    [key: string]: unknown;
  }

  let { expanded = false }: Props = $props();
</script>

<div data-testid="mock-card-content" data-expanded={expanded}></div>
