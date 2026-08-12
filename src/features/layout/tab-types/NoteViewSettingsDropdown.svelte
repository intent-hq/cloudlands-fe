<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faCheck, faFont, faSliders } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { selectIsRawNoteViewEnabled } from '$store/renderer/slices/transient-ui/transient-ui-selectors';
  import { toggleRawNoteView } from '$store/renderer/slices/transient-ui/transient-ui-slice';
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
  const rawNoteViewEnabled = selectIsRawNoteViewEnabled(workspaceIdStore, noteIdStore);

  let open = $state(false);
  const fontOptionClass =
    'relative h-auto min-w-0 flex-col gap-1 rounded-md border border-border bg-transparent px-2 pb-2.5 pt-3 font-normal text-muted-foreground shadow-none hover:border-input hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground data-[state=on]:shadow-none';

  function setFontStyle(value: string) {
    if (value !== 'sans' && value !== 'serif' && value !== 'monospace') return;
    appStore.dispatch(setNoteFontStyle(value as NoteFontStyle));
  }
</script>

{#if embedded}
  <div
    role="group"
    aria-label={m.settings_section_fontStyle()}
    data-menu-stacked-content="font-style"
  >
    <div
      class="type-caption flex items-center gap-2 px-2 pb-1 pt-1.5 font-medium text-muted-foreground"
    >
      <Fa icon={faFont} size="xs" class="w-4 opacity-70" />
      <span>{m.settings_section_fontStyle()}</span>
    </div>
    <Menu.RadioGroup value={$noteFontStyle} onValueChange={setFontStyle}>
      <Menu.RadioItem value="sans" closeOnSelect={false}>
        {m.settings_fontStyle_sans()}
      </Menu.RadioItem>
      <!-- i18n-ignore (font classification name) -->
      <Menu.RadioItem value="serif" closeOnSelect={false}>Serif</Menu.RadioItem>
      <Menu.RadioItem value="monospace" closeOnSelect={false}>
        {m.settings_fontStyle_mono()}
      </Menu.RadioItem>
    </Menu.RadioGroup>
  </div>
  <Menu.Separator />
  <Menu.CheckboxItem
    checked={$spellcheckEnabled}
    closeOnSelect={false}
    onCheckedChange={() => appStore.dispatch(toggleSpellcheck())}
  >
    {m.ui_viewSettings_spellcheck_label()}
  </Menu.CheckboxItem>
  <Menu.CheckboxItem
    checked={$rawNoteViewEnabled}
    closeOnSelect={false}
    onCheckedChange={() => appStore.dispatch(toggleRawNoteView(workspaceId, noteId))}
  >
    {m.ui_viewSettings_rawMarkdown_label()}
  </Menu.CheckboxItem>
{:else}
  <Menu.Root bind:open>
    <Menu.Trigger>
      {#snippet child({ props })}
        <span class="contents" {...props}>
          <Button
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
        </span>
      {/snippet}
    </Menu.Trigger>
    <Menu.Content align="end" class="w-72 p-3!" aria-label={m.ui_dropdownMenu_ariaLabel()}>
      <section aria-label={m.settings_section_fontStyle()}>
        <ToggleGroup.Root
          type="single"
          value={$noteFontStyle}
          onValueChange={setFontStyle}
          variant="outline"
          size="sm"
          class="grid w-full grid-cols-3 gap-2 border-0 bg-transparent p-0"
        >
          <ToggleGroup.Item value="sans" class={fontOptionClass}>
            {#if $noteFontStyle === 'sans'}
              <Fa icon={faCheck} size="xs" class="absolute right-1.5 top-1.5 text-primary" />
            {/if}
            <span class="type-title font-normal leading-none"
              >{m.notes_fontStyleButton_specimen_label()}</span
            >
            <span class="type-caption font-normal">{m.settings_fontStyle_sans()}</span>
          </ToggleGroup.Item>
          <ToggleGroup.Item value="serif" class={fontOptionClass}>
            {#if $noteFontStyle === 'serif'}
              <Fa icon={faCheck} size="xs" class="absolute right-1.5 top-1.5 text-primary" />
            {/if}
            <span class="type-title font-serif font-normal leading-none"
              >{m.notes_fontStyleButton_specimen_label()}</span
            >
            <!-- i18n-ignore (font classification name) -->
            <span class="type-caption font-normal">Serif</span>
          </ToggleGroup.Item>
          <ToggleGroup.Item value="monospace" class={fontOptionClass}>
            {#if $noteFontStyle === 'monospace'}
              <Fa icon={faCheck} size="xs" class="absolute right-1.5 top-1.5 text-primary" />
            {/if}
            <span class="type-title font-mono font-normal leading-none"
              >{m.notes_fontStyleButton_specimen_label()}</span
            >
            <span class="type-caption font-normal">{m.settings_fontStyle_mono()}</span>
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      </section>

      <Menu.Separator class="my-3" />
      <Menu.CheckboxItem
        checked={$spellcheckEnabled}
        closeOnSelect={false}
        onCheckedChange={() => appStore.dispatch(toggleSpellcheck())}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_spellcheck_label()}
      </Menu.CheckboxItem>
      <Menu.CheckboxItem
        checked={$rawNoteViewEnabled}
        closeOnSelect={false}
        onCheckedChange={() => appStore.dispatch(toggleRawNoteView(workspaceId, noteId))}
        class="data-[state=checked]:bg-transparent"
      >
        {m.ui_viewSettings_rawMarkdown_label()}
      </Menu.CheckboxItem>
    </Menu.Content>
  </Menu.Root>
{/if}
