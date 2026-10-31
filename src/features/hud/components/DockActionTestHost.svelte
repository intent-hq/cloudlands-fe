<script lang="ts">
  import DockRail from './DockRail.svelte';
  import { dockRailPreview } from './dock-rail.preview-fixtures';

  let attempts = $state(0);
  async function failOpen(): Promise<void> {
    attempts += 1;
    throw new Error('open failed');
  }
</script>

<output data-testid="open-attempts">{attempts}</output>
<DockRail
  workspaces={dockRailPreview.states['four-mixed'].props.workspaces}
  staticData
  onOpenWorkspace={failOpen}
/>
