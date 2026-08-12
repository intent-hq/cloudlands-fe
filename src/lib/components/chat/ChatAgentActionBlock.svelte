<script lang="ts">
  import { faRobot } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  let { goal }: { goal: string } = $props();
</script>

<div
  class="ws-block-widget type-body my-2 flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-foreground shadow-(--elevation-raised)"
>
  <Fa icon={faRobot} size="sm" class="shrink-0 text-muted-foreground" />
  <span class="min-w-0 flex-1 truncate">{goal}</span>
</div>
