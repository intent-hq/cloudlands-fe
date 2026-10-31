<script lang="ts">
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';

  /** Small "Plain folder" tag for workspaces with no git (PROTOCOL §5.1 Plain-folder workspaces). */
  let { class: className }: { class?: string } = $props();
</script>

<span
  class={cn(
    'type-caption inline-flex h-5 shrink-0 items-center rounded-sm bg-muted-foreground/10 px-1.5 font-normal leading-5 text-muted-foreground',
    className,
  )}
  title={m.workspace_plainFolder_label_tooltip()}
  data-plain-folder-label
>
  {m.workspace_plainFolder_label()}
</span>
