<script module lang="ts">
  import type { RootStoreHmrData } from '$store/renderer/root-store-lifecycle';

  const storeLifecycleData: RootStoreHmrData = {};
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ToolUseBlock } from '$shared/types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import ContextEngineToolCall from '../ContextEngineToolCall.svelte';
  import ToolCall from '../ToolCall.svelte';

  let {
    theme = 'light',
    zoom = 1,
    width = 720,
  }: { theme?: 'light' | 'dark'; zoom?: number; width?: number } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] }, storeLifecycleData);
  onDestroy(disposeStore);

  const longText = 'tool-call-running-status-contract-'.repeat(16);
  const generic = (id: string, name: string, input: Record<string, unknown>) =>
    ({ type: 'tool_use', id, name, input }) as ToolUseBlock;
  const context = (id: string) =>
    generic(id, 'codebase-retrieval', { information_request: longText });
</script>

<section
  class:dark={theme === 'dark'}
  style:zoom
  style:width="{width}px"
  data-testid="tool-status-host"
>
  <div data-row="generic-running">
    <ToolCall
      toolUse={generic('generic-running', 'launch-process', { command: longText })}
      toolState="running"
    />
  </div>
  <div data-row="generic-success">
    <ToolCall
      toolUse={generic('generic-success', 'set_workspace_title_workspace-mcp', {
        title: 'Updated title',
      })}
      toolState="completed"
      result={{ ok: true }}
    />
  </div>
  <div data-row="generic-error">
    <ToolCall
      toolUse={generic('generic-error', 'launch-process', { command: 'exit 1' })}
      toolState="error"
      result="Command failed"
    />
  </div>
  <div data-row="generic-action">
    <ToolCall
      toolUse={generic('generic-action', 'read_note_workspace-mcp', {
        noteId: 'spec',
        title: 'Spec',
      })}
      toolState="completed"
    />
  </div>
  <div data-row="context-running">
    <ContextEngineToolCall toolUse={context('context-running')} toolState="running" />
  </div>
  <div data-row="context-success">
    <ContextEngineToolCall
      toolUse={context('context-success')}
      toolState="completed"
      result="Retrieved result"
    />
  </div>
  <div data-row="context-error">
    <ContextEngineToolCall
      toolUse={context('context-error')}
      toolState="error"
      result="Search failed"
    />
  </div>
</section>
