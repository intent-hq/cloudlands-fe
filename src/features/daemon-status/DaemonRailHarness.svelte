<script lang="ts">
  import { onMount } from 'svelte';
  import { createDaemonRailFixture } from './daemon-rail.fixture';
  import MachineRail from '$features/machine-rail/MachineRail.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { WINDOW_TITLEBAR_HEIGHT_PX } from '$lib/components/layout/titlebar-geometry';
  import DaemonAuditHarness from './DaemonAuditHarness.svelte';
  import DaemonStoppedOverlay from './DaemonStoppedOverlay.svelte';
  import DaemonUpdatingOverlay from './DaemonUpdatingOverlay.svelte';

  let { scenario = 'updating', rail = true }: { scenario?: string; rail?: boolean } = $props();
  let current = $state('audit-host');
  let draft = $state('Keep this draft');
  let backgroundActions = $state(0);

  onMount(() => createDaemonRailFixture(rail, (id) => (current = id)));
</script>

<DaemonAuditHarness state={scenario}>
  <div class="panel-layout-container flex h-screen flex-col bg-background text-foreground">
    <header
      class="flex shrink-0 items-center justify-end px-2"
      style:height="{WINDOW_TITLEBAR_HEIGHT_PX}px"
    >
      <Button variant="ghost" size="sm" data-testid="window-control">Window control</Button>
    </header>
    <div class="flex min-h-0 flex-1 p-2">
      <MachineRail />
      <main class="min-w-0 flex-1 rounded-xl bg-sidebar p-6">
        <Textarea aria-label="Draft" bind:value={draft} />
        <Button onclick={() => backgroundActions++}>Background action</Button>
      </main>
    </div>
  </div>
  {#if current === 'audit-host'}
    <DaemonUpdatingOverlay />
    <DaemonStoppedOverlay />
  {/if}
  <output
    data-testid="rail-recovery-state"
    data-machine={current}
    data-background={backgroundActions}
    hidden
  ></output>
</DaemonAuditHarness>
