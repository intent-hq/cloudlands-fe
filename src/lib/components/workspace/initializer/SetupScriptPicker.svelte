<script lang="ts">
  import { tick } from 'svelte';
  import Fa from 'svelte-fa';
  import { faPen, faPlus } from '@fortawesome/free-solid-svg-icons';
  import { Combobox, type ComboboxOption } from '$lib/components/ui/combobox';
  import * as Popover from '$lib/components/ui/popover';
  import { useDialogPortalTarget } from '$lib/components/ui/dialog';
  import { ActionRow } from '$lib/components/ui/menu';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';
  import { pushEscapeLayer } from '$lib/utils/escapeLayers';
  import {
    getLastUsedSetupScript,
    getTemplateContent,
    REPO_CONFIG_SCRIPT_ID,
    REPO_CONFIG_SCRIPT_NAME,
    SETUP_SCRIPT_TEMPLATES,
    setupScriptDisplayName,
    type SetupScriptChoice,
    type SetupScriptNameSource,
  } from '$features/setup-scripts';
  import { m } from '$shared/paraglide/messages.js';
  import SetupScriptTrigger from './SetupScriptTrigger.svelte';
  import { workspacePickerStyles } from './workspace-picker-styles';
  import { canPlaceBeside } from '$lib/components/ui/overlay-positioning';

  let {
    open = $bindable(false),
    value,
    scriptName,
    scriptNameSource,
    repositoryKey,
    githubUrl,
    repoConfigScript,
    loading = false,
    onSelect,
    onEdit,
    onCreate,
  }: {
    open?: boolean;
    value: string;
    scriptName: string;
    scriptNameSource: SetupScriptNameSource;
    repositoryKey?: string;
    githubUrl?: string | null;
    repoConfigScript?: string | null;
    loading?: boolean;
    onSelect: (choice: SetupScriptChoice) => void;
    onEdit: () => void;
    onCreate: () => void;
  } = $props();

  const isMobile = new IsMobile();
  let menuBelow = $state(false);
  const dialogPortalTarget = useDialogPortalTarget();
  let searchInput = $state<HTMLInputElement | null>(null);
  let trigger = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);
  let openingEditor = false;
  $effect(() => {
    if (!open) return;
    return pushEscapeLayer((event) => {
      if (!event.isComposing) open = false;
    });
  });
  const currentChoice = $derived<SetupScriptChoice>({
    content: value,
    name: scriptName,
    source: scriptNameSource,
  });
  const lastUsed = $derived(
    open && repositoryKey ? getLastUsedSetupScript(repositoryKey, githubUrl) : undefined,
  );

  function matches(a: SetupScriptChoice, b: SetupScriptChoice): boolean {
    return a.content.trim() === b.content.trim() && a.name === b.name && a.source === b.source;
  }

  const options = $derived.by(() => {
    const choices: Array<ComboboxOption & { data: SetupScriptChoice }> = [];
    if (repoConfigScript) {
      choices.push({
        value: REPO_CONFIG_SCRIPT_ID,
        label: setupScriptDisplayName(REPO_CONFIG_SCRIPT_NAME, 'repo-config'),
        data: { content: repoConfigScript, name: REPO_CONFIG_SCRIPT_NAME, source: 'repo-config' },
      });
    }
    if (lastUsed) {
      const choice: SetupScriptChoice = {
        content: lastUsed.content,
        // i18n-ignore (stored setup-script identity)
        name: lastUsed.nameSource === 'repo-config' ? 'Custom' : lastUsed.name,
        source: lastUsed.nameSource === 'repo-config' ? 'custom' : lastUsed.nameSource,
      };
      choices.push({
        value: 'last-used',
        label: m.workspace_setupScriptEditor_lastUsed_label(),
        description: setupScriptDisplayName(choice.name, choice.source),
        data: choice,
      });
    }
    for (const template of SETUP_SCRIPT_TEMPLATES) {
      choices.push({
        value: 'template-' + template.id,
        label: template.name,
        data: { content: getTemplateContent(template), name: template.name, source: 'named' },
      });
    }
    if (!choices.some((option) => matches(option.data, currentChoice))) {
      choices.unshift({
        value: 'current',
        label: setupScriptDisplayName(scriptName, scriptNameSource),
        data: currentChoice,
      });
    }
    return choices;
  });
  const selectedValue = $derived(
    options.find((option) => matches(option.data, currentChoice))?.value,
  );

  async function edit(create: boolean) {
    openingEditor = true;
    open = false;
    // Release the picker focus scope before the editor captures its return target.
    await tick();
    if (create) onCreate();
    else onEdit();
  }
</script>

<Popover.Root
  bind:open
  onOpenChange={(next) => {
    if (next) {
      openingEditor = false;
      menuBelow = !canPlaceBeside(trigger, 360);
    }
  }}
>
  <Popover.Trigger>
    {#snippet child({ props })}
      <SetupScriptTrigger
        bind:ref={trigger}
        presentation="form"
        value={!repositoryKey && !githubUrl && !value.trim() && scriptNameSource === 'custom'
          ? m.workspace_setupScriptPicker_choose_label()
          : setupScriptDisplayName(scriptName, scriptNameSource)}
        {loading}
        expanded={open}
        triggerProps={props}
        onOpen={() => (open = true)}
      />
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    role="dialog"
    aria-label={m.workspace_setupScriptEditor_setupScript_label()}
    side={isMobile.current || menuBelow ? 'bottom' : 'left'}
    align={isMobile.current || menuBelow ? 'end' : 'start'}
    sideOffset={isMobile.current || menuBelow ? 4 : 24}
    portalProps={{ to: dialogPortalTarget() }}
    strategy={dialogPortalTarget() ? 'absolute' : 'fixed'}
    preventScroll={false}
    class="flex min-h-0 w-[360px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0"
    style="max-height: min(440px, var(--bits-popover-content-available-height, calc(100dvh - 1rem)))"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      searchInput?.focus();
    }}
    onCloseAutoFocus={(event) => {
      event.preventDefault();
      if (!openingEditor) trigger?.focus();
    }}
    onkeydown={(event) => {
      if (event.key === 'Enter') event.stopPropagation();
    }}
  >
    <Combobox
      value={selectedValue}
      {options}
      {open}
      bind:inputRef={searchInput}
      ariaLabel={m.workspace_setupScriptEditor_setupScript_label()}
      placeholder={m.workspace_setupScriptPicker_search_placeholder()}
      searchPlaceholder={m.workspace_setupScriptPicker_search_placeholder()}
      staticPosition
      inputVariant="search"
      size="compact"
      class="flex min-h-0 flex-1 flex-col gap-1 px-2 pt-1 pb-2"
      inputClass="shrink-0"
      rowClass={workspacePickerStyles.row}
      viewportClass="min-h-0 max-h-none flex-1 p-0"
      contentClass="flex min-h-0 max-h-none flex-1 flex-col border-0 shadow-none"
      oncommit={(_, option) => {
        onSelect(option.data as SetupScriptChoice);
        open = false;
      }}
      onopenchange={(next) => {
        if (!next) open = false;
      }}
    />
    <div class="shrink-0 border-t border-border p-2">
      <ActionRow class={workspacePickerStyles.row} onclick={() => edit(false)}>
        {#snippet leading()}<Fa icon={faPen} class={workspacePickerStyles.icon} />{/snippet}
        {#snippet title()}{m.workspace_setupScriptPicker_edit_label()}{/snippet}
      </ActionRow>
      <ActionRow class={workspacePickerStyles.row} onclick={() => edit(true)}>
        {#snippet leading()}<Fa icon={faPlus} class={workspacePickerStyles.icon} />{/snippet}
        {#snippet title()}{m.workspace_setupScriptAgent_createScript_label()}{/snippet}
      </ActionRow>
    </div>
  </Popover.Content>
</Popover.Root>
