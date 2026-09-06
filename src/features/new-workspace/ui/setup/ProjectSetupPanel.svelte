<script lang="ts">
  import Fa from 'svelte-fa';
  import { faChevronUp } from '$lib/icons/phosphor-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { DraftSource } from '$shared/types/workspace-draft';
  import type { SourcePresentation } from '../types';
  import SourceCard, { type SourcePickerMode } from '../SourceCard.svelte';
  import ProjectSection from './ProjectSection.svelte';
  import SetupSummaryRow from './SetupSummaryRow.svelte';

  interface Props {
    source: DraftSource | null;
    presentation?: SourcePresentation;
    expanded: boolean;
    disabled?: boolean;
    pickerOpen?: boolean;
    pickerMode?: SourcePickerMode;
    onExpandedChange?: (expanded: boolean) => void;
    onPickerOpenChange?: (open: boolean) => void;
    onOpenPicker?: (mode: SourcePickerMode) => void;
    onChooseNewFolder?: (name: string) => void;
    onSourceSelected?: (source: DraftSource) => void;
  }

  let {
    source,
    presentation,
    expanded,
    disabled = false,
    pickerOpen = false,
    pickerMode = 'github',
    onExpandedChange,
    onPickerOpenChange,
    onOpenPicker,
    onChooseNewFolder,
    onSourceSelected,
  }: Props = $props();
</script>

<section
  class="rounded-xl border border-border bg-background shadow-sm"
  data-testid="project-setup-panel"
>
  {#if expanded}
    <button
      type="button"
      class="flex w-full items-start gap-3 rounded-t-xl px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-expanded="true"
      aria-controls="project-setup-content"
      onclick={() => onExpandedChange?.(false)}
    >
      <span class="min-w-0 flex-1">
        <span class="type-small block font-medium">{m.newWorkspace_setup_panel_title()}</span>
        <span class="type-caption block text-muted-foreground">
          {m.newWorkspace_setup_panel_description()}
        </span>
      </span>
      <Fa icon={faChevronUp} class="mt-1 size-3.5 shrink-0 text-muted-foreground" />
    </button>
    <div id="project-setup-content" class="border-t border-border px-4 py-4">
      <ProjectSection {disabled} {onOpenPicker} onSelectSource={onSourceSelected} />
    </div>
  {:else}
    <SetupSummaryRow {source} onExpand={() => onExpandedChange?.(true)} />
  {/if}

  <SourceCard
    {source}
    {presentation}
    {disabled}
    showSummary={false}
    {pickerOpen}
    {pickerMode}
    {onPickerOpenChange}
    {onChooseNewFolder}
    {onSourceSelected}
  />
</section>
