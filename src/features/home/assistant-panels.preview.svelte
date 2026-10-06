<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview({
    id: 'assistant-panels',
    title: 'Assistant content panels',
    defaultState: 'default',
    states: { default: { props: {} } },
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

  const stop = startHomePreview(() => [setupAssistantPanelsFixture()]);
  onDestroy(stop);

  const links =
    '[Open the plan](intent://local/note/plan) · [Open the second plan](intent://local/note/second)\n\n[Open repository](https://github.com/acme/studio) · [Open missing note](intent://local/note/missing) · [Open workspace plan](intent://local/example-workspace/note/plan)';
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
