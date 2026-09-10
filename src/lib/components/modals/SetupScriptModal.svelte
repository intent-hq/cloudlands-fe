<script lang="ts">
  /**
   * SetupScriptModal - Modal wrapper around SetupScriptEditor
   * Uses local state so changes only apply on Done, and Cancel discards them.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import SetupScriptEditor from '$lib/components/workspace/initializer/SetupScriptEditor.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import type { ProjectType, SetupScriptNameSource } from '$features/setup-scripts';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    repoPath?: string;
    /** Source URL for GitHub selections (last-used keys on path + URL). */
    githubUrl?: string | null;
    projectType?: ProjectType;
    /** Setup script committed in the repo's `.intent/config.json`, if any */
    repoConfigScript?: string | null;
    value?: string;
    scriptName?: string;
    /** True identity of `scriptName` — drives display-label localization. */
    scriptNameSource?: SetupScriptNameSource;
    isCustomScript?: boolean;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    repoPath = '',
    githubUrl = null,
    projectType = undefined,
    repoConfigScript = null,
    value = $bindable(''),
    scriptName = $bindable('Custom'),
    scriptNameSource = $bindable('named'),
    isCustomScript = $bindable(false),
    onClose,
  }: Props = $props();

  // Local state — edits happen here, only committed on Done
  let localValue = $state('');
  let localScriptName = $state('Custom');
  let localScriptNameSource = $state<SetupScriptNameSource>('named');
  let localIsCustomScript = $state(false);
  let editorExpanded = $state(true);
  let escapeKeydownBehavior = $state<'close' | 'ignore'>('close');
  const localHasUnsavedChanges = $derived(
    localValue !== value ||
      localScriptName !== scriptName ||
      localIsCustomScript !== isCustomScript,
  );

  // Snapshot parent values when modal opens
  $effect(() => {
    if (open) {
      localValue = value;
      localScriptName = scriptName;
      localScriptNameSource = scriptNameSource;
      localIsCustomScript = isCustomScript;
      editorExpanded = true;
    }
  });

  function handleDone() {
    value = localValue;
    scriptName = localScriptName;
    scriptNameSource = localScriptNameSource;
    isCustomScript = localIsCustomScript;
    open = false;
    onClose?.();
  }

  function handleSaveAndDone() {
    handleDone();
  }

  function handleCancel() {
    open = false;
    onClose?.();
  }

  function handleFocusIn(event: FocusEvent) {
    const target = event.target;
    escapeKeydownBehavior =
      target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        ? 'ignore'
        : 'close';
  }
</script>

<FormDialog
  bind:open
  title={m.modals_setupScript_title()}
  showCloseButton={false}
  {escapeKeydownBehavior}
  onfocusin={handleFocusIn}
  enterKey="ignore"
  modEnter="ignore"
  class="max-w-6xl"
  onSubmit={handleDone}
  onCancel={handleCancel}
>
  <SetupScriptEditor
    {repoPath}
    {githubUrl}
    {projectType}
    {repoConfigScript}
    bind:value={localValue}
    bind:expanded={editorExpanded}
    bind:scriptName={localScriptName}
    bind:scriptNameSource={localScriptNameSource}
    bind:isCustomScript={localIsCustomScript}
    contentOnly={true}
  />
  {#snippet footer()}
    <Button variant="ghost" onclick={handleCancel}>{m.modals_setupScript_cancel_label()}</Button>
    {#if localHasUnsavedChanges}
      <Button variant="primary" onclick={handleSaveAndDone}>
        {m.modals_setupScript_saveAndDone_label()}
      </Button>
    {:else}
      <Button variant="primary" onclick={handleDone}>{m.modals_setupScript_done_label()}</Button>
    {/if}
  {/snippet}
</FormDialog>
