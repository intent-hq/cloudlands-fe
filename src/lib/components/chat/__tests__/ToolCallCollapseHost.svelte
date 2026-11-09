<script module lang="ts">
  import type { RootStoreHmrData } from '$store/renderer/root-store-lifecycle';

  const storeLifecycleData: RootStoreHmrData = {};
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolUseBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import ToolCall from '../ToolCall.svelte';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] }, storeLifecycleData);
  onDestroy(disposeStore);

  const toolUse = {
    type: 'tool_use',
    id: 'collapse-tool',
    name: 'launch-process',
    input: { command: 'ls -la' },
  } as ToolUseBlock;
  const result = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');
</script>

<section style:width="720px" data-testid="tool-collapse-host">
  <ToolCall {toolUse} toolState="completed" {result} />
</section>
