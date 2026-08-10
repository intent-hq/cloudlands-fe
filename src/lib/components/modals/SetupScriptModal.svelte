<script lang="ts">
  /**
   * SetupScriptModal - Modal wrapper around SetupScriptEditor
   * Uses local state so changes only apply on Done, and Cancel discards them.
   */
  import Modal from './Modal.svelte';
  import SetupScriptEditor from '$lib/components/workspace/initializer/SetupScriptEditor.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { ProjectType } from '$features/setup-scripts';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    repoPath?: string;
    projectType?: ProjectType;
    /** Setup script committed in the repo's `.intent/config.json`, if any */
    repoConfigScript?: string | null;
    value?: string;
    scriptName?: string;
    isCustomScript?: boolean;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    repoPath = '',
    projectType = undefined,
    repoConfigScript = null,
    value = $bindable(''),
    scriptName = $bindable('Custom'),
    isCustomScript = $bindable(false),
    onClose,
  }: Props = $props();

  // Local state — edits happen here, only committed on Done
  let localValue = $state('');
  let localScriptName = $state('Custom');
  let localIsCustomScript = $state(false);
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
    open = false;
    onClose?.();
  }

  function handleCancel() {
    open = false;
    onClose?.();
  }
</script>

<Modal bind:open title={m.modals_setupScript_title()} contentClass="p-0" onClose={handleCancel}>
  <SetupScriptEditor
    {repoPath}
    {projectType}
    {repoConfigScript}
    bind:value={localValue}
    bind:expanded={editorExpanded}
    bind:scriptName={localScriptName}
    bind:isCustomScript={localIsCustomScript}
    contentOnly={true}
  />
  <div class="flex items-center justify-end gap-3 px-6 py-3 border-t border-border shrink-0">
    <Button variant="ghost" onclick={handleCancel}>{m.modals_setupScript_cancel_label()}</Button>
    <Button class="text-white" onclick={handleDone}>{m.modals_setupScript_done_label()}</Button>
  </div>
</Modal>
