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

<div class="flex items-center gap-2.5">
  {#if item.type === 'message' && item.isArchivedWorkspace}
    <span
      class="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-foreground/[0.05] text-subtle flex-none"
    >
      {m.lib_commandPalette_archivedWorkspace_pill_label()}
    </span>
  {/if}
  <span class="text-[14px] font-medium text-foreground truncate">{item.label}</span>
  {#if item.type === 'message' && item.workspaceName}
    <span class="text-xs text-subtle truncate">
      <span aria-hidden="true">·</span>
      {item.workspaceName}
      {#if item.repoLabel}
        <span aria-hidden="true">·</span>
        {item.repoLabel}
      {/if}
    </span>
  {/if}
  {#if item._time}
    <span class="text-ui text-subtle flex-none ml-auto">{item._time}</span>
  {/if}
</div>
