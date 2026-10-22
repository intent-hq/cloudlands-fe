<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    item: {
      type?: string;
      label?: string;
      description?: string;
      breadcrumbs?: string;
      path?: string;
      workspaceName?: string;
      repoLabel?: string;
      isArchivedWorkspace?: boolean;
      _time?: string;
    };
  }

  let { item }: Props = $props();
  const context = $derived(
    item.type === 'note' && item.breadcrumbs
      ? item.breadcrumbs
      : item.type === 'change' || item.type === 'file'
        ? item.path || item.description
        : item.description,
  );
  const detail = $derived(
    [
      ...((item.type === 'message' || item.type === 'note') && item.workspaceName
        ? [item.workspaceName, item.repoLabel]
        : []),
      context,
    ]
      .filter(Boolean)
      .join(' · '),
  );
</script>

<span
  class="flex min-w-0 items-center gap-2 whitespace-nowrap"
  title={[item.label, detail].filter(Boolean).join(' — ')}
>
  {#if (item.type === 'message' || item.type === 'note') && item.isArchivedWorkspace}
    <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 type-caption text-muted-foreground">
      {m.lib_commandPalette_archivedWorkspace_pill()}
    </span>
  {/if}
  <span class="min-w-0 truncate type-body text-foreground {detail ? 'min-[480px]:max-w-[65%]' : ''}"
    >{item.label}</span
  >
  {#if detail}
    <span class="min-w-0 flex-1 truncate type-caption text-muted-foreground max-[479px]:sr-only">
      {#if (item.type === 'message' || item.type === 'note') && item.workspaceName}
        <span aria-hidden="true">·</span>
      {/if}
      {detail}
    </span>
  {/if}
  {#if item._time}
    <span class="ml-auto shrink-0 type-caption text-muted-foreground">{item._time}</span>
  {/if}
</span>
