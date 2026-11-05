<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Screen } from '$lib/components/patterns/screen';
  import DockRecordingEditor from '$features/hud/media-editor/recording/DockRecordingEditor.svelte';
  import { connectDockCaptureEditor } from '$features/hud/media-editor/capture-editor-bridge';
  import type { DockCaptureEditorSnapshot } from '$shared/dock-capture-editor';

  let snapshot = $state.raw<DockCaptureEditorSnapshot | null>(null);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- isolated editor window with no app store; the bridge owns its IPC
  const bridge = connectDockCaptureEditor((next) => (snapshot = next));
  onDestroy(() => bridge.dispose());
</script>

<Screen class="h-full w-full">
  {#if snapshot?.kind === 'recording'}
    {#key snapshot.openId}
      <DockRecordingEditor {snapshot} onClose={() => snapshot && bridge.close(snapshot.openId)} />
    {/key}
  {/if}
</Screen>
