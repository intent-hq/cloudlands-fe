<script lang="ts">
  /**
   * The workspace header's home line: which machine holds the workspace's
   * files, terminals and scripts, and its state when it is not attached.
   * Hover shows the last backup. Nothing without a home.
   */
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Badge } from '$lib/components/ui/badge';
  import Fa from '$lib/components/shared/icons/FaWrapper.svelte';
  import { faHardDrive } from '$lib/icons/phosphor-icons';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceHomeView } from '../workspace-home';
  import { homeLastBackupText, homeMarkerLabel } from '../workspace-home-copy';

  let { view }: { view: WorkspaceHomeView | null } = $props();

  const lastBackup = $derived(view ? homeLastBackupText(view) : null);
</script>

{#snippet line(home: WorkspaceHomeView, props: Record<string, unknown> = {})}
  <span
    {...props}
    class="type-caption flex h-5 min-w-0 items-center gap-1.5 leading-5 text-muted-foreground"
    data-workspace-home-line={home.state}
  >
    <Fa icon={faHardDrive} class="size-3.5 shrink-0" />
    <span class="min-w-0 truncate">{m.workspaceHome_header_label({ name: home.name })}</span>
    <!-- The last backup is a hover tooltip; screen readers get it inline. -->
    {#if lastBackup}<span class="sr-only">{lastBackup}</span>{/if}
    {#if home.starting}
      <!-- A cloud home's sandbox is starting: its state instead of a marker. -->
      <span class="flex shrink-0 items-center gap-1" data-workspace-home-starting>
        <span aria-hidden="true"><IntentMarkLoader size={12} /></span>
        <!-- The one live announcement while the home starts. -->
        <span role="status">{m.workspaceHome_starting_label()}</span>
      </span>
    {:else if home.marker}
      <Badge
        variant="dot"
        color={home.marker === 'detached' ? 'amber' : 'blue'}
        size="compact"
        class="shrink-0">{homeMarkerLabel(home.marker)}</Badge
      >
    {/if}
  </span>
{/snippet}

{#if view}
  {#if lastBackup}
    <Tooltip.Provider
      ><Tooltip.Root
        ><Tooltip.Trigger
          >{#snippet child({ props })}{@render line(view, props)}{/snippet}</Tooltip.Trigger
        ><Tooltip.Content>{lastBackup}</Tooltip.Content></Tooltip.Root
      ></Tooltip.Provider
    >
  {:else}
    {@render line(view)}
  {/if}
{/if}
