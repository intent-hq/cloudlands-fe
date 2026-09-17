<!--
  First title line of a regular command-palette result row: an optional
  archived-workspace pill (chat-message rows only), the item label, the
  message row's workspace/repo segments, and the relative-time suffix.
-->
<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    item: {
      type?: string;
      label?: string;
      workspaceName?: string;
      repoLabel?: string;
      isArchivedWorkspace?: boolean;
      _time?: string;
    };
  }

  let { item }: Props = $props();
</script>

<span class="flex min-w-0 items-baseline gap-2">
  {#if item.type === 'message' && item.isArchivedWorkspace}
    <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 type-caption text-muted-foreground">
      {m.lib_commandPalette_archivedWorkspace_pill()}
    </span>
  {/if}
  <span class="min-w-0 truncate type-caption text-foreground">{item.label}</span>
  {#if item.type === 'message' && item.workspaceName}
    <span class="min-w-0 truncate type-caption text-muted-foreground">
      <span aria-hidden="true">·</span>
      {item.workspaceName}
      {#if item.repoLabel}
        <span aria-hidden="true">·</span>
        {item.repoLabel}
      {/if}
    </span>
  {/if}
  {#if item._time}
    <span class="ml-auto shrink-0 type-caption text-muted-foreground">{item._time}</span>
  {/if}
</span>
