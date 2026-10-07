<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    ASSISTANT_DIAGRAM_NOTE,
    ASSISTANT_DIAGRAM_ERROR_NOTE,
    ASSISTANT_DIAGRAM_EXAMPLE_NOTE,
  } from './assistant-note-diagrams-fixtures';
  interface Props {
    noteContent?: string;
    workspaceView?: 'editor' | 'raw';
  }
  export const preview = definePreview<Props>({
    id: 'assistant-panels',
    title: 'Assistant content panels',
    defaultState: 'default',
    states: {
      default: { props: {} },
      workspaceEditor: { props: { workspaceView: 'editor' } },
      workspaceMarkdown: { props: { workspaceView: 'raw' } },
      diagrams: { props: { noteContent: ASSISTANT_DIAGRAM_NOTE } },
      'diagram-errors': { props: { noteContent: ASSISTANT_DIAGRAM_ERROR_NOTE } },
      'diagram-examples': { props: { noteContent: ASSISTANT_DIAGRAM_EXAMPLE_NOTE } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import HomeAssistantPanels from './HomeAssistantPanels.svelte';
  import { startHomePreview } from './home-preview-lifecycle';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import MarkdownViewer from '$lib/components/markdown/MarkdownViewer.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import {
    setupAssistantPanelsFixture,
    showPlanFromAssistant,
  } from './assistant-panels-browser-fixtures';
  import './home.css';

  let { noteContent, workspaceView }: Props = $props();
  const stop = startHomePreview(() => [setupAssistantPanelsFixture(noteContent, workspaceView)]);
  onDestroy(stop);

  const links =
    '[Open the plan](intent://local/note/plan) · [Open the second plan](intent://local/note/second)\n\n[Open repository](https://github.com/acme/studio) · [Open missing note](intent://local/note/missing) · [Open workspace plan](intent://local/example-workspace/note/plan)\n\n[Open empty note](intent://local/note/empty) · [Open long note](intent://local/note/long)\n\n[Open unavailable workspace note](intent://local/unavailable-workspace/note/plan) · [Open workspace lookup failure note](intent://local/failing-workspace/note/plan)';
</script>

<div class="assistant-panels-preview h-[780px] w-full bg-sidebar p-3 text-foreground">
  <HomeAssistantPanels>
    {#snippet children()}
      <section class="flex h-full min-h-0 flex-col">
        <header class="border-b border-border px-6 py-4 font-medium">Assistant</header>
        <div class="min-h-0 flex-1 overflow-auto p-6">
          <p class="mb-5">Here is the repository plan. Open it beside our conversation.</p>
          <MarkdownViewer content={links} workspaceId={CHIEF_WORKSPACE_ID} />
          <Button class="mt-5" variant="outline" onclick={() => void showPlanFromAssistant()}
            >Assistant shows a plan</Button
          >
        </div>
        <div class="p-6">
          <Input aria-label="Message the Assistant" placeholder="Message the Assistant" />
        </div>
      </section>
    {/snippet}
  </HomeAssistantPanels>
</div>

<style>
  .assistant-panels-preview {
    container: home-layout / inline-size;
  }
</style>
