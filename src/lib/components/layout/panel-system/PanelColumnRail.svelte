<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import type { PanelColumnCount } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { isPanelColumnCount } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { PANEL_COLUMN_RAIL_WIDTH } from '$shared/panel-layout-sizing';

  let {
    count,
    onCountChange,
  }: {
    count: PanelColumnCount;
    onCountChange: (count: PanelColumnCount) => void;
  } = $props();

  const columnCounts = [1, 2, 3, 4] as const;

  function handleCountChange(value: string) {
    const nextCount = Number(value);
    if (isPanelColumnCount(nextCount)) onCountChange(nextCount);
  }

  function countLabel(value: PanelColumnCount) {
    return value === 1
      ? m.layout_panelColumnRail_count_one({ count: value })
      : m.layout_panelColumnRail_count_many({ count: value });
  }
</script>

{#snippet columnIcon(value: PanelColumnCount)}
  {@const width = value * 4 + (value - 1) * 2}
  <svg
    viewBox="0 0 24 18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linejoin="round"
    aria-hidden="true"
    data-panel-column-icon={value}
  >
    {#each Array.from({ length: value }) as _, index}
      <rect
        x={12 - width / 2 + index * 6}
        y="2"
        width="4"
        height="14"
        rx="1"
        vector-effect="non-scaling-stroke"
      />
    {/each}
  </svg>
{/snippet}

<aside
  class="flex h-full shrink-0 justify-center border-l border-border bg-sidebar px-3 py-3"
  style:width={`${PANEL_COLUMN_RAIL_WIDTH}px`}
  aria-label={m.layout_panelColumnRail_ariaLabel()}
  data-panel-column-rail
>
  <Menu.Root>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="outline"
          size="sm"
          class="h-8 min-w-14 gap-1.5 rounded-lg bg-card/80 px-2 shadow-xs backdrop-blur-sm transition-colors motion-reduce:transition-none"
          aria-label={m.layout_panelColumnRail_currentCount_ariaLabel({ count })}
          tooltip={m.layout_panelColumnRail_currentCount_tooltip({ count })}
          tooltipSide="left"
          data-panel-column-count-trigger
        >
          <span class="size-5" data-panel-column-count-icon>{@render columnIcon(count)}</span>
          <span class="type-caption tabular-nums text-foreground" data-panel-column-count
            >{count}</span
          >
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" side="bottom" class="w-44">
      <Menu.RadioGroup value={String(count)} onValueChange={handleCountChange}>
        {#each columnCounts as option}
          <Menu.RadioItem value={String(option)}>
            <span class="size-5 text-muted-foreground">{@render columnIcon(option)}</span>
            <span>{countLabel(option)}</span>
          </Menu.RadioItem>
        {/each}
      </Menu.RadioGroup>
    </Menu.Content>
  </Menu.Root>
</aside>
