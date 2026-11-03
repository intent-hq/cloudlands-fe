<script lang="ts">
  /**
   * SetupScriptModal - Modal wrapper around SetupScriptEditor
   * Uses local state so changes only apply on Done, and Cancel discards them.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { isTextEntryTarget } from '$lib/utils/text-entry';
  import { untrack, type Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import type { ProjectType, SetupScriptNameSource } from '$features/setup-scripts';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    editor?: Snippet<[string, (value: string) => void]>;
    repoPath?: string;
    /** Qualified repository identity for last-used defaults, separate from a filesystem path. */
    repositoryKey?: string;
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
    /** Start a blank draft without changing the current selection until Done. */
    createNew?: boolean;
    onClose?: () => void;
    onCommit?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    editor,
    repoPath = '',
    repositoryKey,
    githubUrl = null,
    projectType = undefined,
    repoConfigScript = null,
    value = $bindable(''),
    scriptName = $bindable('Custom'),
    scriptNameSource = $bindable('named'),
    isCustomScript = $bindable(false),
    createNew = false,
    onClose,
    onCommit,
  }: Props = $props();
  let wasOpen = false;
  let closed = false;

  // Local state — edits happen here, only committed on Done
  let localValue = $state('');
  let localScriptName = $state('Custom');
  let localScriptNameSource = $state<SetupScriptNameSource>('named');
  let localIsCustomScript = $state(false);
  let editorExpanded = $state(true);
  let editorSession = $state(0);
  let escapeKeydownBehavior = $state<'close' | 'ignore'>('close');
  const localHasUnsavedChanges = $derived(
    localValue !== value ||
      localScriptName !== scriptName ||
      localIsCustomScript !== isCustomScript,
  );

  // Snapshot parent values when modal opens
  $effect(() => {
    if (open && !wasOpen) {
      untrack(() => {
        localValue = createNew ? '' : value;
        // i18n-ignore (stored setup-script identity)
        localScriptName = createNew ? 'Custom' : scriptName;
        localScriptNameSource = createNew ? 'custom' : scriptNameSource;
        localIsCustomScript = createNew || isCustomScript;
        editorExpanded = true;
        // A dialog outro can retain the old editor during a rapid reopen.
        // Each draft needs fresh internal selection and edit provenance.
        editorSession += 1;
        closed = false;
      });
    }
    wasOpen = open;
  });

  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((event) => {
      if (
        isTextEntryTarget(event.target) ||
        (event.target instanceof Element && event.target.closest('.monaco-editor'))
      )
        return false;
      handleCancel();
    });
  });

  function close() {
    if (closed) return;
    closed = true;
    open = false;
    onClose?.();
  }

  function handleDone() {
    if (closed) return;
    value = localValue;
    scriptName = localScriptName;
    scriptNameSource =
      localIsCustomScript && localScriptNameSource === 'repo-config'
        ? 'custom'
        : localScriptNameSource;
    if (scriptNameSource === 'custom') scriptName = 'Custom';
    isCustomScript = localIsCustomScript;
    onCommit?.();
    close();
  }

  function handleSaveAndDone() {
    handleDone();
  }

  function handleCancel() {
    close();
  }

  function handleFocusIn(event: FocusEvent) {
    const target = event.target;
    // Monaco widgets (find/replace controls) own Escape even when they are not text entry.
    escapeKeydownBehavior =
      isTextEntryTarget(target) || (target instanceof Element && target.closest('.monaco-editor'))
        ? 'ignore'
        : 'close';
  }
</script>

{#snippet editorContent()}
  {#if editor}
    {@render editor(localValue, (next) => (localValue = next))}
  {:else}
    {#await import('$lib/components/workspace/initializer/SetupScriptEditor.svelte')}
      <div class="flex items-center justify-center py-8" role="status">
        <IntentMarkLoader size={16} />
        <span class="sr-only">{m.ui_spinner_loading_ariaLabel()}</span>
      </div>
    {:then { default: SetupScriptEditor }}
      <SetupScriptEditor
        {repoPath}
        {repositoryKey}
        {githubUrl}
        {projectType}
        {repoConfigScript}
        bind:value={localValue}
        bind:expanded={editorExpanded}
        bind:scriptName={localScriptName}
        bind:scriptNameSource={localScriptNameSource}
        bind:isCustomScript={localIsCustomScript}
        contentOnly
        presentation="editor"
        contentClass="h-[min(34rem,calc(100dvh-12rem))] min-h-80"
      />
    {/await}
  {/if}
{/snippet}

{#snippet submitAction()}
  {#if localHasUnsavedChanges}
    <Button variant="primary" onclick={handleSaveAndDone}>
      {m.modals_setupScript_saveAndDone_label()}
    </Button>
  {:else}
    <Button variant="primary" onclick={handleDone}>{m.modals_setupScript_done_label()}</Button>
  {/if}
{/snippet}

<FormDialog
  bind:open
  static={staticPosition}
  title={m.modals_setupScript_title()}
  showCloseButton={false}
  {escapeKeydownBehavior}
  onfocusin={handleFocusIn}
  enterKey="ignore"
  modEnter="ignore"
  size="editor"
  onSubmit={handleDone}
  onCancel={handleCancel}
>
  {#key editorSession}
    {@render editorContent()}
  {/key}
  {#snippet footer()}
    <Button variant="ghost" onclick={handleCancel}>{m.modals_setupScript_cancel_label()}</Button>
    {@render submitAction()}
  {/snippet}
</FormDialog>
