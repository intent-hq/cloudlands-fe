<script lang="ts">
  /**
   * SetupScriptModal - Modal wrapper around SetupScriptEditor
   * Uses local state so changes only apply on Done, and Cancel discards them.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import { isTextEntryTarget } from '$lib/utils/text-entry';
  import { untrack, type Snippet } from 'svelte';
  import { Button, type ButtonProps } from '$lib/components/ui/button';
  import type { ProjectType, SetupScriptNameSource } from '$features/setup-scripts';
  import { m } from '$shared/paraglide/messages.js';
  import { workspacePickerStyles } from '$lib/components/workspace/initializer/workspace-picker-styles';
  import { fade } from '$lib/motion';

  interface Props {
    open?: boolean;
    static?: boolean;
    presentation?: 'dialog' | 'popover' | 'inline';
    trigger?: Snippet<[ButtonProps]>;
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
    onClose?: () => void;
    onCommit?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    presentation = 'dialog',
    trigger,
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
    onClose,
    onCommit,
  }: Props = $props();
  const isMobile = new IsMobile();
  const dialogPortalTarget = useDialogPortalTarget();
  let wasOpen = false;
  let closed = false;

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
    if (open && !wasOpen) {
      untrack(() => {
        localValue = value;
        localScriptName = scriptName;
        localScriptNameSource = scriptNameSource;
        localIsCustomScript = isCustomScript;
        editorExpanded = true;
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
        presentation={presentation === 'popover'
          ? 'picker'
          : presentation === 'inline'
            ? 'workspace'
            : 'editor'}
        contentClass={presentation === 'popover'
          ? 'min-h-0'
          : presentation === 'inline'
            ? 'h-full min-h-0'
            : 'h-[min(34rem,calc(100dvh-12rem))] min-h-80'}
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

{#if presentation === 'popover'}
  <Popover.Root bind:open onOpenChange={(next) => !next && close()}>
    <Popover.Trigger>
      {#snippet child({ props })}{@render trigger?.(props)}{/snippet}
    </Popover.Trigger>
    <Popover.Content
      role="dialog"
      aria-label={m.workspace_setupScriptEditor_setupScript_label()}
      side={isMobile.current ? 'bottom' : 'left'}
      align={isMobile.current ? 'end' : 'start'}
      sideOffset={isMobile.current ? 4 : 24}
      portalProps={{ to: dialogPortalTarget() }}
      strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
      class="flex w-[440px] max-w-[calc(100vw-1rem)] min-h-0 flex-col overflow-hidden p-0"
      style="max-height: min(560px, var(--bits-popover-content-available-height, calc(100dvh - 1rem)))"
      {escapeKeydownBehavior}
      onfocusin={handleFocusIn}
    >
      <div class={workspacePickerStyles.header}>
        <h2 class={workspacePickerStyles.title}>{m.workspace_compactInitializer_setup_label()}</h2>
        <p class={workspacePickerStyles.description}>
          {m.workspace_setupScriptPicker_description()}
        </p>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {@render editorContent()}
      </div>
      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-3">
        <Button variant="ghost" size="sm" onclick={handleCancel}
          >{m.modals_setupScript_cancel_label()}</Button
        >
        <Button variant="primary" size="sm" onclick={handleDone}
          >{m.chat_shared_apply_label()}</Button
        >
      </div>
    </Popover.Content>
  </Popover.Root>
{:else if presentation === 'inline'}
  {#if open}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions (tracks editor focus for Escape ownership) -->
    <div
      class="setup-script-inline"
      role="region"
      aria-label={m.workspace_setupScriptEditor_setupScript_label()}
      onfocusin={handleFocusIn}
      in:fade={{ tier: 'moderate' }}
      out:fade={{ tier: 'moderate' }}
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        {@render editorContent()}
      </div>
      <div class="flex shrink-0 items-center justify-end gap-2 pt-3">
        {@render submitAction()}
      </div>
    </div>
  {/if}
{:else}
  <FormDialog
    bind:open
    static={staticPosition}
    title={m.modals_setupScript_title()}
    description={m.workspace_compactInitializer_setup_description()}
    showCloseButton={false}
    {escapeKeydownBehavior}
    onfocusin={handleFocusIn}
    enterKey="ignore"
    modEnter="ignore"
    size="editor"
    onSubmit={handleDone}
    onCancel={handleCancel}
  >
    {@render editorContent()}
    {#snippet footer()}
      <Button variant="ghost" onclick={handleCancel}>{m.modals_setupScript_cancel_label()}</Button>
      {@render submitAction()}
    {/snippet}
  </FormDialog>
{/if}

<style>
  .setup-script-inline {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    max-height: calc(100dvh - 12rem);
  }

  @container (width < 48rem) {
    .setup-script-inline {
      padding-bottom: 1rem;
    }
  }
</style>
