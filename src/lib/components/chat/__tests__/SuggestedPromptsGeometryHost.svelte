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
      prompts={['Review the implementation and verify the focused behavior.']}
      onSelect={() => {}}
      showShortcutHints
      {compact}
    />
    <div class="mt-4" data-testid="tool-call-reference">
      <ToolCall toolUse={toolReference} toolState="completed" result="done" />
    </div>
  </div>
</section>
