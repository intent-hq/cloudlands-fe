<script lang="ts">
  /**
   * SetupScriptModal - Modal wrapper around SetupScriptEditor
   * Uses local state so changes only apply on Done, and Cancel discards them.
   */
  import Modal from './Modal.svelte';
  import SetupScriptEditor from '$lib/components/workspace/initializer/SetupScriptEditor.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { ProjectType } from '$features/setup-scripts';

  interface Props {
    open?: boolean;
    repoPath?: string;
    projectType?: ProjectType;
    value?: string;
    scriptName?: string;
    isCustomScript?: boolean;
    onClose?: () => void;
    onchange?: (value: string) => void;
  }

  let {
    open = $bindable(false),
    repoPath = '',
    projectType = undefined,
    value = $bindable(''),
    scriptName = $bindable('Custom'),
    isCustomScript = $bindable(false),
    onClose,
    onchange,
  }: Props = $props();

  // Local state — edits happen here, only committed on Done
  let localValue = $state('');
  let localScriptName = $state('Custom');
  let localIsCustomScript = $state(false);
  let localHasUnsavedChanges = $state(false);
  let editorExpanded = $state(true);

  // Snapshot parent values when modal opens
  $effect(() => {
    if (open) {
      localValue = value;
      localScriptName = scriptName;
      localIsCustomScript = isCustomScript;
      editorExpanded = true;
    }
  });

  function handleDone() {
    value = localValue;
    scriptName = localScriptName;
    isCustomScript = localIsCustomScript;
    onchange?.(localValue);
    open = false;
    onClose?.();
  }

  let editorRef: SetupScriptEditor | undefined;

  function handleSaveAndDone() {
    editorRef?.save();
    handleDone();
  }

  function handleCancel() {
    open = false;
    onClose?.();
  }
</script>

<Modal bind:open title="Setup Script" contentClass="p-0" onClose={handleCancel}>
  <SetupScriptEditor
    bind:this={editorRef}
    {repoPath}
    {projectType}
    bind:value={localValue}
    bind:expanded={editorExpanded}
    bind:scriptName={localScriptName}
    bind:isCustomScript={localIsCustomScript}
    bind:hasUnsavedChanges={localHasUnsavedChanges}
    contentOnly={true}
  />
  <div class="flex items-center justify-end gap-3 px-6 py-3 border-t border-border shrink-0">
    <Button variant="ghost" onclick={handleCancel}>Cancel</Button>
    {#if localHasUnsavedChanges}
      <Button class="text-white" onclick={handleSaveAndDone}>
        Save & Done
      </Button>
    {:else}
      <Button class="text-white" onclick={handleDone}>Done</Button>
    {/if}
  </div>
</Modal>
