<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import UnifiedMachineMarker from '$features/unified-window/components/UnifiedMachineMarker.svelte';
  import type { UnifiedMachine } from '$features/unified-window/unified-machines';

  interface Props {
    item: {
      type?: string;
      label?: string;
      description?: string;
      breadcrumbs?: string;
      path?: string;
      workspaceName?: string;
      repoLabel?: string;
      /** Repo rows: where the repo starts from ("GitHub", "GitLab"), in place of a folder path. */
      sourceLabel?: string;
      isArchivedWorkspace?: boolean;
      isRetiredWorkspace?: boolean;
      /** Unified window: the workspace's machine; offline machines grey the row. */
      machine?: UnifiedMachine;
      _time?: string;
    };
  }

  let { item }: Props = $props();
  const context = $derived(
    item.sourceLabel
      ? item.sourceLabel
      : item.type === 'note' && item.breadcrumbs
        ? item.breadcrumbs
        : item.type === 'change' || item.type === 'file'
          ? item.path || item.description
          : item.description,
  );
  const machine = $derived(item.machine);
  const machineName = $derived(
    machine && !machine.online
      ? m.unifiedWindow_machine_offlineName_label({ machine: machine.label })
      : machine?.label,
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
  title={[item.label, detail, machineName].filter(Boolean).join(' — ')}
  data-machine-offline={machine && !machine.online ? true : undefined}
>
  {#if item.isRetiredWorkspace}
    <span
      class="shrink-0 rounded bg-muted px-1.5 py-0.5 type-caption text-muted-foreground"
      data-palette-retired-badge
    >
      {m.lib_commandPalette_archivedWorkspace_pill()}
    </span>
  {/if}
  {#if (item.type === 'message' || item.type === 'note') && item.isArchivedWorkspace}
    <span class="shrink-0 rounded bg-muted px-1.5 py-0.5 type-caption text-muted-foreground">
      {m.lib_commandPalette_archivedWorkspace_pill()}
    </span>
  {/if}
  <span
    class={cn(
      'min-w-0 truncate type-body',
      machine && !machine.online ? 'text-muted-foreground' : 'text-foreground',
      detail && 'min-[480px]:max-w-[65%]',
    )}>{item.label}</span
  >
  {#if detail}
    <span class="min-w-0 flex-1 truncate type-caption text-muted-foreground max-[479px]:sr-only">
      {#if (item.type === 'message' || item.type === 'note') && item.workspaceName}
        <span aria-hidden="true">·</span>
      {/if}
      {detail}
    </span>
  {/if}
  {#if machine && machineName}
    <span
      class="ml-auto flex min-w-0 shrink items-center gap-1.5 type-caption text-muted-foreground"
      data-palette-machine={machine.id}
    >
      <UnifiedMachineMarker {machine} />
      <span class="truncate">{machineName}</span>
    </span>
  {/if}
  {#if item._time}
    <span class={cn('shrink-0 type-caption text-muted-foreground', !machine && 'ml-auto')}
      >{item._time}</span
    >
  {/if}
</span>
