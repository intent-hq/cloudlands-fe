<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { untrack } from 'svelte';
  import DevConsoleShell from './DevConsoleShell.svelte';
  import { createTrafficFixture, type PayloadScenario } from './traffic-fixture';
  import type { LinksScenario } from './daemon-links-fixture';
  import * as m from '$shared/paraglide/messages.js';
  let {
    count = 240,
    scenario = 'traffic',
    links = 'unsupported',
  }: { count?: number; scenario?: PayloadScenario; links?: LinksScenario } = $props();
  const fixture = untrack(() => createTrafficFixture(count, scenario, links));
</script>

<div class="fixture">
  <span>{m.devConsole_fixture_label()}</span><Button
    size="compact"
    variant="ghost"
    wrapContent={false}
    class="fixture-control"
    onclick={() => (scenario === 'streams' ? fixture.stream() : fixture.append(300))}
    >{m.devConsole_append_label()}</Button
  >
  {#if links === 'backend' || links === 'machine'}
    <!-- i18n-ignore (Synthetic browser-test fixture control.) -->
    <Button
      size="compact"
      variant="ghost"
      class="fixture-control"
      onclick={() => fixture.appendLinks(40)}>Append link frames</Button
    >
  {/if}
  {#if scenario === 'nested'}
    <!-- i18n-ignore (Synthetic browser-test fixture control.) -->
    <Button size="compact" variant="ghost" onclick={() => fixture.reply()}
      >Deliver fixture reply</Button
    >
  {/if}
</div>
<DevConsoleShell connect={fixture.connect} />

<style>
  .fixture {
    position: fixed;
    top: 4px;
    left: 130px;
    max-width: calc(100vw - 360px);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    font: 11px monospace;
    color: hsl(var(--muted-foreground));
  }
  .fixture > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
