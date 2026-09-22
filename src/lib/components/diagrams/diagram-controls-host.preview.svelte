<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CUSTOM_WORKBENCH_CASES,
    DIAGRAM_WORKBENCH_CASES,
  } from './diagram-workbench.preview-fixtures';

  export const preview = definePreview({
    id: 'diagram-controls-host',
    get title() {
      return m.sandbox_diagramWorkbench_review_title();
    },
    defaultState: 'notes',
    captureReadiness: { selector: '[data-diagram-settled="true"]', count: 4 },
    states: { notes: { props: {} } },
  });
</script>

<script lang="ts">
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import NoteWithComments from '$lib/components/workspace/NoteWithComments.svelte';
  import { Button } from '$lib/components/ui/button';

  let enabled = $state(true);
  let mounted = $state(true);
  let note = $state(0);
  // Synthetic identities have no backing store note or persistence callback.
  const workspace: Workspace = {
    id: WorkspaceId('diagram-controls-preview'),
    title: 'Local diagram controls',
    branch: 'preview',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  const diagrams = [
    CUSTOM_WORKBENCH_CASES['custom-architecture'],
    CUSTOM_WORKBENCH_CASES['custom-delivery-walkthrough'],
  ];
  const walkthroughs = diagrams
    .map((fixture) => `\`\`\`diagram\n${JSON.stringify(fixture.diagram)}\n\`\`\``)
    .join('\n\n');
  const lead = 'Before the diagrams.\n\n'.repeat(12);
  const tail = '\n\nAfter the diagrams.'.repeat(24);
  const mermaid = DIAGRAM_WORKBENCH_CASES['mermaid-flow'];
  const stateless = `\`\`\`diagram\n${JSON.stringify(CUSTOM_WORKBENCH_CASES['custom-flowchart'].diagram)}\n\`\`\`\n\n\`\`\`mermaid\n${mermaid.kind === 'mermaid' ? mermaid.source : ''}\n\`\`\``;
  const content = $derived(
    lead + (note % 3 === 0 ? walkthroughs : note % 3 === 1 ? 'Prose note.' : stateless) + tail,
  );
</script>

<!-- i18n-ignore (deterministic preview-only lifecycle controls) -->
<div class="flex gap-3 mb-3">
  <Button onclick={() => (enabled = !enabled)} data-testid="toggle-band">Toggle editor view</Button>
  <Button onclick={() => (note += 1)} data-testid="switch-note">Switch note</Button>
  <Button onclick={() => (mounted = !mounted)} data-testid="toggle-mount">Toggle host</Button>
</div>

<div class="hosts">
  {#each [0, 1] as index}
    {#if mounted || index === 1}
      <article class="note-host" data-testid={`note-host-${index}`}>
        <NoteWithComments
          {workspace}
          noteId={`diagram-controls-${index}-${index === 0 ? note : 0}`}
          content={index === 0 ? content : lead + walkthroughs + tail}
          editable={false}
          showComments={false}
          showSuggestions={false}
          showVersionHistory={index === 0 && !enabled}
        />
      </article>
    {/if}
  {/each}
</div>

<style>
  .hosts {
    display: grid;
    gap: 24px;
  }
  .note-host {
    display: flex;
    flex-direction: column;
    height: 560px;
    min-width: 0;
    overflow: hidden;
    background: hsl(var(--background));
  }
</style>
