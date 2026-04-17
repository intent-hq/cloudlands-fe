<script lang="ts">
  import { faPlus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    count: number;
    onToggle: () => void;
  }

  let { count, onToggle }: Props = $props();

  const label = $derived(`${count} older workspaces`);
</script>

<button
  type="button"
  class="flex items-center justify-start gap-1 w-full px-4.75 py-3 text-xs text-subtle hover:bg-muted/30 transition-colors cursor-pointer"
  onclick={onToggle}
>
  <span class="shrink-0 ml-1.25 flex items-center justify-center opacity-50">
    <Fa icon={faPlus} size={12} />
  </span>
  <span>{label}</span>
</button>
