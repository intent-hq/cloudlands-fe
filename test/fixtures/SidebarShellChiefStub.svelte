<script lang="ts">
  let { expanded = false }: { expanded?: boolean; embedded?: boolean } = $props();
</script>

<div class="h-full rounded-lg border border-border bg-sidebar" data-chief-card-surface>
  <span class="text-sidebar-foreground">{expanded ? 'Expanded' : 'Collapsed'}</span>
</div>
