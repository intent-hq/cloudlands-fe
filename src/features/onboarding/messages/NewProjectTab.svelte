<script lang="ts">
  /**
   * NewProjectTab — New project creation for onboarding.
   *
   * Folder picker + project name input. Creates a new directory.
   */
  import { onMount } from 'svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { createLogger } from '$lib/utils/client-logger';
  import Input from '$lib/components/ui/input/input.svelte';
  import { faFolder } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import DirectoryPickerModal from './DirectoryPickerModal.svelte';

  const logger = createLogger('NewProjectTab');

  interface Props {
    parentPath: string;
    projectName: string;
    nameError?: string;
    onParentPathChange: (path: string) => void;
    onProjectNameChange: (name: string) => void;
  }

  // Submit/continue is handled by the unified button at the bottom of the
  // onboarding flow (see `+page.svelte`). This tab only collects data.
  let { parentPath, projectName, nameError, onParentPathChange, onProjectNameChange }: Props = $props();

  // Auto-focus the project name input when this tab becomes active. The
  // parent uses {#key activeTab}, so this component re-mounts on every tab
  // switch and onMount fires each time. We select() the contents so the
  // default value is highlighted and the user can immediately type to
  // replace it.
  let projectNameInputRef = $state<HTMLInputElement | null>(null);
  onMount(() => {
    projectNameInputRef?.focus();
    projectNameInputRef?.select();
  });


  let pickerOpen = $state(false);

  function handleSelectParentFolder() {
    pickerOpen = true;
  }

  function handlePickerSelect(pickedPath: string) {
    pickerOpen = false;
    try {
      onParentPathChange(pickedPath);
    } catch (err) {
      logger.error('Failed to select parent folder', err);
    }
  }
</script>

<div class="space-y-3">
  <p class="text-base text-muted-foreground pb-3">
    {m.onboarding_newProjectTab_startFresh_description()}
  </p>
  <!-- Combined path input -->
  <div
    class="flex items-center rounded-lg border border-border/50 bg-card/50 text-sm overflow-hidden"
  >
    <button
      type="button"
      class="flex items-center gap-1.5 shrink-0 px-3 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer border-r border-border/30"
      onclick={handleSelectParentFolder}
      title={m.onboarding_newProjectTab_changeParent_tooltip()}
    >
      <Fa icon={faFolder} class="text-subtle/50 -mb-px" size={20} />
      <span class="truncate max-w-48">
        {parentPath
          ? `${parentPath.replace(/^\/Users\/[^/]+/, '~').replace(/\/$/, '')}/`
          : m.onboarding_newProjectTab_selectFolder_label()}
      </span>
    </button>
    <Input
      id="project-name"
      bind:ref={projectNameInputRef}
      type="text"
      value={projectName}
      noFocusStyle
      oninput={(e) => onProjectNameChange(e.currentTarget.value)}
      placeholder={m.onboarding_newProjectTab_projectName_placeholder()}
      class="flex-1 border-none! bg-transparent! rounded-none! shadow-none! ring-0! focus:ring-0! px-2! py-3!"
    />
  </div>
  {#if nameError}
    <p class="text-sm text-red-500 px-1">{nameError}</p>
  {/if}
</div>

<DirectoryPickerModal
  open={pickerOpen}
  title={m.onboarding_newProjectTab_selectParentFolder_title()}
  initialPath={parentPath}
  selectLabel={m.onboarding_dirPicker_selectFolder_label()}
  onSelect={handlePickerSelect}
  onClose={() => (pickerOpen = false)}
/>
