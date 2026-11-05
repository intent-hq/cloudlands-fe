<script lang="ts">
  import type { WorkspaceTabGroupColor } from '$store/renderer/slices/tab-state/tab-groups';

  interface Props {
    color: WorkspaceTabGroupColor;
    edge: 'start' | 'middle' | 'end';
  }

  let { color, edge }: Props = $props();
</script>

<!-- One outline around the open group, drawn as joined segments: the chip
     starts it, member tabs continue it and the last tab ends it. The bottom
     stays open so the selected tab still joins the panel below. -->
<span
  class="tab-group-outline"
  data-edge={edge}
  style:--tab-group-color={`var(--tab-group-${color})`}
  aria-hidden="true"
></span>

<style>
  .tab-group-outline {
    position: absolute;
    z-index: 15;
    inset: 0 -2px 0 0;
    border-color: hsl(var(--tab-group-color) / 0.5);
    border-style: solid;
    border-width: 1px 0 0;
    box-shadow: 0 0 0 2px hsl(var(--tab-group-color) / 0.16);
    clip-path: inset(-3px 0 0 0);
    pointer-events: none;
  }

  .tab-group-outline[data-edge='start'] {
    border-left-width: 1px;
    border-top-left-radius: 9px;
    clip-path: inset(-3px 0 0 -3px);
  }

  .tab-group-outline[data-edge='end'] {
    right: 0;
    border-right-width: 1px;
    border-top-right-radius: 9px;
    clip-path: inset(-3px -3px 0 0);
  }
</style>
