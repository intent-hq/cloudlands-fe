<script lang="ts" module>
  import type { Workspace } from '$shared/types';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import {
    PREVIEW_FIXTURE_IDS,
    PREVIEW_FIXTURE_TIMESTAMPS,
    definePreviewFixture,
  } from '$lib/component-catalog/preview-fixtures';

  export interface EditableTextPreviewProps {
    layout: 'normal' | 'edge-cases' | 'narrow' | 'dense-context';
    mode: 'display' | 'editing';
  }

  interface TextCase {
    id: string;
    label: string;
    value: string;
    disabled?: boolean;
    editable?: boolean;
    editValue?: string;
  }

  const normalCases: TextCase[] = [
    { id: 'normal', label: 'normal title', value: 'Preview implementation plan' },
  ];
  const edgeCases: TextCase[] = [
    { id: 'empty', label: 'empty / placeholder', value: '', editValue: '' },
    { id: 'single', label: 'single character', value: 'A' },
    {
      id: 'long',
      label: 'very long title',
      value: 'A very long editable title that exceeds its maximum width and must handle overflow',
    },
    { id: 'unicode', label: 'spaces + wide unicode', value: '  🌊 東京 workspace ✨  ' },
  ];
  const editableNameEdgeCases: TextCase[] = [
    ...edgeCases,
    { id: 'disabled', label: 'disabled', value: 'Editing unavailable', disabled: true },
  ];
  const contentHeaderEdgeCases: TextCase[] = [
    ...edgeCases,
    {
      id: 'non-editable',
      label: 'editableTitle false',
      value: 'Read-only content',
      editable: false,
    },
  ];

  const workspaceFixture = definePreviewFixture<Workspace>({
    id: WorkspaceId(PREVIEW_FIXTURE_IDS.workspace),
    title: 'Preview implementation plan',
    branch: 'feat/editable-text-preview',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatus.Active,
    displayStatus: 'idle',
    attention: 'none',
    activity: 'idle',
    repositoryOwner: 'intent-hq',
    repositoryName: 'cloudlands-fe',
    repositoryPath: '/repos/cloudlands-fe',
    worktreePath: '/repos/cloudlands-fe/worktrees/editable-text-preview',
    statusMessage: 'Reviewing the inline title treatment.',
    ...PREVIEW_FIXTURE_TIMESTAMPS,
  });

  export const preview = definePreview<EditableTextPreviewProps>({
    id: 'editable-text',
    title: 'Editable text',
    defaultState: 'display',
    states: {
      display: { props: { layout: 'normal', mode: 'display' } },
      editing: { props: { layout: 'normal', mode: 'editing' } },
      'edge-cases': { props: { layout: 'edge-cases', mode: 'display' } },
      'edge-cases-editing': { props: { layout: 'edge-cases', mode: 'editing' } },
      narrow: { props: { layout: 'narrow', mode: 'editing' } },
      'dense-context': { props: { layout: 'dense-context', mode: 'display' } },
    },
  });
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ContentHeader from '$features/layout/components/content-header/ContentHeader.svelte';
  import WorkspaceSidebarHeader from '$lib/components/workspace/WorkspaceSidebarHeader.svelte';
  import EditableName from '$lib/components/ui/EditableName.svelte';

  let { layout, mode }: EditableTextPreviewProps = $props();
  let previewRoot: HTMLElement;

  const cases = $derived(layout === 'edge-cases' ? edgeCases : normalCases);
  const editableNameCases = $derived(layout === 'edge-cases' ? editableNameEdgeCases : normalCases);
  const contentHeaderCases = $derived(
    layout === 'edge-cases' ? contentHeaderEdgeCases : normalCases,
  );
  const shouldEdit = (example: TextCase) =>
    mode === 'editing' && !example.disabled && example.editable !== false;
  const workspaceFor = (example: TextCase) =>
    workspaceFixture({
      id: WorkspaceId(`${PREVIEW_FIXTURE_IDS.workspace}-${example.id}`),
      title: example.value,
    });

  async function enterRequestedEditors() {
    await tick();
    const targets = Array.from(previewRoot.querySelectorAll<HTMLElement>('[data-edit-target]'));
    if (targets.length === 0) return;

    const suppressBlur = (event: FocusEvent) => event.stopImmediatePropagation();
    previewRoot.addEventListener('blur', suppressBlur, true);
    try {
      for (const target of targets) {
        target.querySelector<HTMLButtonElement>('button:not(:disabled)')?.click();
      }
      await tick();
      for (const target of targets) {
        const editValue = target.dataset.editValue;
        const input = target.querySelector<HTMLInputElement>('input[type="text"]');
        if (input && editValue !== undefined) {
          input.value = editValue;
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
      }
      targets[0]?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      await tick();
    } finally {
      previewRoot.removeEventListener('blur', suppressBlur, true);
    }
  }

  onMount(() => {
    void enterRequestedEditors();
  });
</script>

<div
  bind:this={previewRoot}
  class:w-70={layout === 'narrow'}
  class="grid max-w-full gap-8 text-foreground"
  data-editable-text-preview
>
  {#if layout === 'dense-context'}
    <section class="grid gap-3">
      <h2 class="text-lg font-semibold">EditableName</h2>
      {#each ['display', 'editing'] as state (state)}
        <div class="grid gap-2 rounded-md border border-border bg-background p-3">
          <p class="text-xs text-muted-foreground">EditableName — dense context / {state}</p>
          <div
            class="flex min-w-0 items-center gap-2 overflow-hidden rounded border border-border bg-card px-2 py-1.5"
          >
            <span class="shrink-0 text-xs text-muted-foreground">Overview</span>
            <span class="h-4 w-px shrink-0 bg-border"></span>
            <div data-edit-target={state === 'editing' ? true : undefined} class="min-w-0">
              <EditableName value="Preview implementation plan" maxWidth={180} onSave={() => {}} />
            </div>
            <span class="h-4 w-px shrink-0 bg-border"></span>
            <span class="shrink-0 text-xs text-muted-foreground">Changes</span>
          </div>
        </div>
      {/each}
    </section>
  {:else}
    <section class="grid gap-3">
      <h2 class="text-lg font-semibold">EditableName</h2>
      <div class="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
        {#each editableNameCases as example (example.id)}
          <div
            class="min-w-0 rounded-md border border-border bg-background p-3"
            data-edit-target={shouldEdit(example) ? true : undefined}
            data-edit-value={example.editValue}
          >
            <p class="mb-3 text-xs text-muted-foreground">EditableName — {example.label}</p>
            <EditableName
              value={example.value}
              placeholder="Untitled preview"
              disabled={example.disabled}
              maxWidth={layout === 'narrow' ? 220 : 180}
              onSave={() => {}}
            />
          </div>
        {/each}
      </div>
    </section>

    <section class="grid gap-3">
      <h2 class="text-lg font-semibold">ContentHeader</h2>
      <div class="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
        {#each contentHeaderCases as example (example.id)}
          <div
            class="min-w-0 overflow-hidden rounded-md border border-border bg-background"
            data-edit-target={shouldEdit(example) ? true : undefined}
            data-edit-value={example.editValue}
          >
            <p class="px-3 pt-3 text-xs text-muted-foreground">ContentHeader — {example.label}</p>
            <ContentHeader
              title={example.value}
              editableTitle={example.editable !== false}
              showClose={false}
              onTitleChange={() => {}}
            />
          </div>
        {/each}
      </div>
    </section>

    <section class="grid gap-3">
      <h2 class="text-lg font-semibold">WorkspaceSidebarHeader</h2>
      <div class="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
        {#each cases as example (example.id)}
          {@const workspace = workspaceFor(example)}
          <div
            class="min-w-0 rounded-md border border-border bg-sidebar p-3 text-sidebar-foreground"
            data-edit-target={shouldEdit(example) ? true : undefined}
            data-edit-value={example.editValue}
          >
            <p class="mb-3 text-xs text-muted-foreground">
              WorkspaceSidebarHeader — {example.label}
            </p>
            <WorkspaceSidebarHeader {workspace} workspaceId={workspace.id} />
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
