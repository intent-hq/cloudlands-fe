<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { untrack } from 'svelte';
  import DevConsoleShell from './DevConsoleShell.svelte';
  import { createTrafficFixture } from './traffic-fixture';
  import * as m from '$shared/paraglide/messages.js';
  let { count = 240 }: { count?: number } = $props();
  const fixture = untrack(() => createTrafficFixture(count));
</script>

<div class="fixture">
  <span>{m.devConsole_fixture_label()}</span><Button
    size="xs"
    variant="ghost"
    wrapContent={false}
    class="fixture-control"
    onclick={() => fixture.append(300)}>{m.devConsole_append_label()}</Button
  >
</div>
<DevConsoleShell connect={fixture.connect} />

<style>
  .fixture {
    position: fixed;
    top: 4px;
    right: 12px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    font: 11px monospace;
    color: hsl(var(--muted-foreground));
  }
  .fixture :global(.fixture-control) {
    border: 1px solid hsl(var(--border));
    padding: 2px 5px;
  }
  .fixture :global(.fixture-control) {
    height: auto;
    min-height: 0;
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
  }
</style>
