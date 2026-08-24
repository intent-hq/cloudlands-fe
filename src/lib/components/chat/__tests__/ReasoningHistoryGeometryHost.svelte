<script lang="ts">
  import type { ContentBlock } from '$shared/types';
  import MessageContent from '../MessageContent.svelte';

  const history: ContentBlock[] = [
    { type: 'text', id: 'history:0', text: '<group:Prepping>Description before history.' },
    {
      type: 'thinking',
      id: 'history:1',
      text: 'Reasoning\n\n**Assessing delegation and tool availability**\n\n**Inspecting workspace_api method names**',
    },
    {
      type: 'thinking',
      id: 'history:2',
      text: '**Searching workspace.set method descriptions**\n\n**Planning workspace API title setting**\n\nHistory body after every title.',
    },
    {
      type: 'tool_use',
      id: 'history:3',
      toolCallId: 'history-tool',
      name: 'view',
      input: { summary: 'Inspect the workspace API implementation' },
    },
    { type: 'text', id: 'history:4', text: '</group:Prepping>' },
  ];

  const ordinary: ContentBlock[] = [
    { type: 'thinking', id: 'ordinary:0', text: 'First ordinary reasoning' },
    { type: 'thinking', id: 'ordinary:1', text: 'Second ordinary reasoning' },
  ];
</script>

<section class="dark w-[720px] bg-background text-foreground" data-testid="history-geometry-host">
  <div data-testid="history-geometry"><MessageContent content={history} /></div>
  <div data-testid="ordinary-reasoning-geometry"><MessageContent content={ordinary} /></div>
</section>
