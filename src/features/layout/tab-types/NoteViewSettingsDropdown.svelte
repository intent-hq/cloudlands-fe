<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faFont, faSliders } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { selectNoteViewMode } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import {
    setNoteViewMode,
    type NoteViewMode,
  } from '$store/renderer/slices/transient-ui/transient-ui-slice';
  import {
    selectNoteFontStyle,
    selectSpellcheckEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    setNoteFontStyle,
    toggleSpellcheck,
    type NoteFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    workspaceId: string;
    noteId: string;
    /** Render controls within the panel's existing action menu. */
    embedded?: boolean;
  }

  let { workspaceId, noteId, embedded = false }: Props = $props();

  const noteFontStyle = selectNoteFontStyle();
  const spellcheckEnabled = selectSpellcheckEnabled();
  const workspaceIdStore = writable('');
  const noteIdStore = writable('');
  $effect(() => workspaceIdStore.set(workspaceId));
  $effect(() => noteIdStore.set(noteId));
  const noteViewMode = selectNoteViewMode(workspaceIdStore, noteIdStore);

  let open = $state(false);
  const descriptionId = $props.id();
  const fontLabel = $derived(
    $noteFontStyle === 'sans'
      ? m.settings_fontStyle_sans()
      : $noteFontStyle === 'serif'
        ? m.settings_fontStyle_serif()
        : m.settings_fontStyle_mono(),
  );
  const viewLabel = $derived(
    $noteViewMode === 'editor'
      ? m.ui_viewSettings_editor_label()
      : $noteViewMode === 'preview'
        ? m.ui_viewSettings_renderedPreview_label()
        : m.ui_viewSettings_rawMarkdown_label(),
  );

  function setFontStyle(value: string) {
    if (value !== 'sans' && value !== 'serif' && value !== 'monospace') return;
    appStore.dispatch(setNoteFontStyle(value as NoteFontStyle));
  }

  function selectViewMode(value: string) {
    if (value !== 'editor' && value !== 'preview' && value !== 'raw') return;
    appStore.dispatch(setNoteViewMode(workspaceId, noteId, value as NoteViewMode));
  }
</script>

{#snippet settingsItems()}
  <Menu.Sub>
    <Menu.SubTrigger icon={faFont}>
      <span class="min-w-0 flex-1">{m.settings_section_fontStyle()}</span>
      <span class="type-caption text-muted-foreground">{fontLabel}</span>
    </Menu.SubTrigger>
    <Menu.SubContent aria-label={m.settings_section_fontStyle()}>
      <Menu.RadioGroup value={$noteFontStyle} onValueChange={setFontStyle}>
        <Menu.RadioItem value="sans" closeOnSelect={false}>
          {m.settings_fontStyle_sans()}
        </Menu.RadioItem>
        <Menu.RadioItem value="serif" closeOnSelect={false}
          >{m.settings_fontStyle_serif()}</Menu.RadioItem
        >
        <Menu.RadioItem value="monospace" closeOnSelect={false}>
          {m.settings_fontStyle_mono()}
        </Menu.RadioItem>
      </Menu.RadioGroup>
    </Menu.SubContent>
  </Menu.Sub>
  <Menu.Sub>
    <Menu.SubTrigger>
      <span class="min-w-0 flex-1">{m.ui_viewSettings_noteViewMode_label()}</span>
      <span class="type-caption text-muted-foreground">{viewLabel}</span>
    </Menu.SubTrigger>
    <Menu.SubContent aria-label={m.ui_viewSettings_noteViewMode_label()}>
      <Menu.RadioGroup value={$noteViewMode} onValueChange={selectViewMode}>
        <Menu.RadioItem value="editor" closeOnSelect={false}>
          {m.ui_viewSettings_editor_label()}
        </Menu.RadioItem>
        <Menu.RadioItem value="preview" closeOnSelect={false}>
          {m.ui_viewSettings_renderedPreview_label()}
        </Menu.RadioItem>
        <Menu.RadioItem value="raw" closeOnSelect={false}>
          {m.ui_viewSettings_rawMarkdown_label()}
        </Menu.RadioItem>
      </Menu.RadioGroup>
    </Menu.SubContent>
  </Menu.Sub>
  <Menu.CheckboxItem
    checked={$spellcheckEnabled}
    closeOnSelect={false}
    disabled={$noteViewMode === 'preview'}
    aria-describedby={$noteViewMode === 'preview' ? descriptionId : undefined}
    onCheckedChange={() => appStore.dispatch(toggleSpellcheck())}
  >
    {m.ui_viewSettings_spellcheck_label()}
  </Menu.CheckboxItem>
  {#if $noteViewMode === 'preview'}
    <p id={descriptionId} class="type-caption px-2 py-1 text-muted-foreground">
      {m.ui_viewSettings_spellcheckPreview_description()}
    </p>
  {/if}
{/snippet}

{#if embedded}
  {@render settingsItems()}
{:else}
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost-light"
          size="icon-xs"
          tooltip={m.ui_viewSettings_trigger_tooltip()}
          tooltipSide="bottom"
          aria-label={m.ui_viewSettings_trigger_tooltip()}
          aria-expanded={open}
          data-testid="note-view-settings-trigger"
        >
          <Fa icon={faSliders} size="xs" />
        </Button>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" class="w-72" aria-label={m.ui_viewSettings_trigger_tooltip()}>
      {@render settingsItems()}
    </Menu.Content>
  </Menu.Root>
{/if}
