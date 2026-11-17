<!-- @catalog-exempt: shared frame for the daemon connection recovery owners -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { getCounterScaledTitlebarHeight } from '$lib/components/layout/titlebar-geometry';
  import { selectMachineRailEnabled } from '$store/renderer/slices/machine-rail/machine-rail-selectors';
  import { selectZoomFactor } from '$store/renderer/slices/user-preferences/user-preferences-selectors';

  let {
    titleId,
    descriptionId,
    testId,
    keepTitlebar = false,
    posture,
    children,
  }: {
    titleId: string;
    descriptionId: string;
    testId: string;
    keepTitlebar?: boolean;
    posture?: string;
    children: Snippet;
  } = $props();

  const railEnabled$ = selectMachineRailEnabled();
  const zoomFactor$ = selectZoomFactor();
  const keepsNavigation = $derived($railEnabled$ || keepTitlebar);
  const top = $derived(keepsNavigation ? getCounterScaledTitlebarHeight($zoomFactor$) : 0);
</script>

<Portal target="body" zIndex="var(--layer-connection-overlay)">
  <div
    class="fixed right-0 bottom-0 flex items-center justify-center overflow-hidden bg-background/80 p-4 backdrop-blur-md"
    style:top="{top}px"
    style:left="var(--machine-rail-inset, 0px)"
    style:z-index="var(--layer-connection-overlay)"
    role="alertdialog"
    aria-modal={keepsNavigation ? undefined : 'true'}
    aria-labelledby={titleId}
    aria-describedby={descriptionId}
    tabindex="-1"
    data-testid={testId}
    data-posture={posture}
  >
    <div
      class="max-h-full min-w-0 w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-(--elevation-overlay) [overflow-wrap:anywhere]"
    >
      {@render children()}
    </div>
  </div>
</Portal>
