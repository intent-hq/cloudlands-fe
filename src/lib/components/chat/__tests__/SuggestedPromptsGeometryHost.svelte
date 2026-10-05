<script lang="ts">
  import type { ToolUseBlock } from '$shared/types';
  import SuggestedPrompts from '../SuggestedPrompts.svelte';
  import ToolCall from '../ToolCall.svelte';
  import { store as appStore } from '$store/renderer/store';

  appStore.init();

  interface Props {
    compact?: boolean;
    theme?: 'light' | 'dark';
    width?: number;
    zoom?: number;
  }

  let { compact = false, theme = 'light', width = 480, zoom = 1 }: Props = $props();
  let selected = $state('');
  let edited = $state('');
  let selectionCount = $state(0);
  let editCount = $state(0);

  const toolReference: ToolUseBlock = {
    type: 'tool_use',
    id: 'message-reference:0',
    name: 'view',
    input: { path: 'src/example.ts' },
    toolCallId: 'tool-reference',
    metadata: { toolKind: 'read', status: 'completed' },
  };
</script>

<section class:dark={theme === 'dark'} style:width="{width}px" style:zoom>
  <div class="bg-background p-4 text-foreground" data-testid="suggested-prompts-geometry-host">
    <SuggestedPrompts
      prompts={[
        'Review the change.',
        'Review the implementation carefully and verify every focused behavior before continuing.',
      ]}
      onSelect={(prompt) => {
        selected = prompt;
        selectionCount += 1;
      }}
      onEdit={(prompt) => {
        edited = prompt;
        editCount += 1;
      }}
      showShortcutHints
      {compact}
    />
    <div class="mt-4" data-testid="tool-call-reference">
      <ToolCall toolUse={toolReference} toolState="completed" result="done" />
    </div>
    <output data-testid="selected-prompt">{selected}</output>
    <output data-testid="edited-prompt">{edited}</output>
    <output data-testid="selection-count">{selectionCount}</output>
    <output data-testid="edit-count">{editCount}</output>
  </div>
</section>
