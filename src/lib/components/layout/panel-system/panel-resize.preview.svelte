<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview({
    id: 'panel-resize',
    title: 'Panel resize dividers',
    defaultState: 'pair',
    states: {
      pair: { props: { scenario: 'pair', direction: 'horizontal', nested: false } },
      multi: { props: { scenario: 'pair', direction: 'horizontal', nested: false, panelCount: 3 } },
      single: { props: { scenario: 'create-agent', direction: 'horizontal', nested: false } },
      stacked: { props: { scenario: 'pair', direction: 'vertical', nested: false } },
      nested: { props: { scenario: 'pair', direction: 'horizontal', nested: true } },
    },
  });
</script>

<script lang="ts">
  import PanelWorkspaceColumnClipHarness from './__tests__/mocks/PanelWorkspaceColumnClipHarness.svelte';

  let {
    scenario = 'pair',
    direction = 'horizontal',
    nested = false,
    panelCount = 2,
  }: {
    scenario?: 'pair' | 'create-agent';
    direction?: 'horizontal' | 'vertical';
    nested?: boolean;
    panelCount?: number;
  } = $props();
</script>

<div data-panel-resize-preview>
  <PanelWorkspaceColumnClipHarness
    {scenario}
    {direction}
    {nested}
    {panelCount}
    sidebarWidth={0}
    canvasWidth={720}
    persistedCanvasWidth={720}
    pristine
  />
</div>
