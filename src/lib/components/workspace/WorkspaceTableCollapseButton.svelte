<script lang="ts">
  import { faMinus } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    onCollapse: () => void;
  }

  let { onCollapse }: Props = $props();
</script>

<button
  type="button"
  class="flex items-center justify-start gap-1 w-full px-4.75 py-3 text-xs text-subtle hover:bg-muted/30 transition-colors cursor-pointer"
  onclick={onCollapse}
>
  <span class="shrink-0 flex ml-1.25 items-center justify-center opacity-50">
    <Fa icon={faMinus} size={12} />
  </span>
  <span>Hide older workspaces</span>
</button>
