<script lang="ts">
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import FontPicker from '$features/settings/FontPicker.svelte';
  import { keepToggleSelected } from '$lib/components/settings/utils/keep-toggle-selected';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import {
    setAgentFontStyle,
    setCodeFontFamily,
    setNoteFontStyle,
    type AgentFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import {
    selectAgentFontStyle,
    selectCodeFontFamily,
    selectCodeFontFamilyCSS,
    selectCodeFontOptions,
    selectIsNoteMonospace,
    selectNoteFontStyle,
  } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';

  let { show }: { show: (row: string) => boolean } = $props();

  const noteFontStyle = selectNoteFontStyle();
  const isNoteMonospace = selectIsNoteMonospace();
  const agentFontStyle = selectAgentFontStyle();
  const codeFontFamily = selectCodeFontFamily();
  const codeFontFamilyCSS = selectCodeFontFamilyCSS();
  const codeFontOptions = selectCodeFontOptions();

  const fontStyleOptions = [
    { value: 'sans', label: m.settings_fontStyle_sans() },
    { value: 'monospace', label: m.settings_fontStyle_mono() },
  ];

  function handleNoteFontChange(value: string | string[]) {
    appStore.dispatch(setNoteFontStyle(value as 'sans' | 'monospace'));
  }

  function handleAgentFontChange(value: string | string[]) {
    appStore.dispatch(setAgentFontStyle(value as AgentFontStyle));
  }

  function handleCodeFontChange(value: string) {
    appStore.dispatch(setCodeFontFamily(value));
  }
</script>

<div id="font-style" data-highlight-id="font-style" use:highlightTarget>
  <h2 class="type-title mb-3 text-foreground">
    {m.settings_section_fontStyle()}
  </h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    {#if show('note-font')}
      <section
        id="note-font"
        data-highlight-id="note-font"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <SettingsFieldRow
          id="settings-font-notes-label-field"
          label={m.settings_font_notes_label()}
        >
          {#snippet descriptionContent()}<span
              class="type-body text-subtle mt-0.5 transition-all duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
              class:font-mono={$isNoteMonospace}
            >
              {m.settings_font_notes_description()}
            </span>{/snippet}
          <ToggleGroup.Root
            variant="outline"
            type="single"
            bind:value={() => $noteFontStyle, handleNoteFontChange}
            size="sm"
            aria-label={m.settings_font_notes_label()}
            class="ml-4 shrink-0"
          >
            {#each fontStyleOptions as option (option.value)}
              <ToggleGroup.Item value={option.value} {...keepToggleSelected}>
                {option.label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
        </SettingsFieldRow>
      </section>
    {/if}
    {#if show('agent-chat-font')}
      <section
        id="agent-chat-font"
        data-highlight-id="agent-chat-font"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <SettingsFieldRow
          id="settings-font-agentChat-label-field"
          label={m.settings_font_agentChat_label()}
        >
          {#snippet descriptionContent()}<span
              class="type-body text-subtle mt-0.5 transition-all duration-spring-moderate ease-spring-moderate motion-reduce:transition-none"
              class:font-mono={$agentFontStyle === 'monospace'}
            >
              {m.settings_font_agentChat_description()}
            </span>{/snippet}
          <ToggleGroup.Root
            variant="outline"
            type="single"
            bind:value={() => $agentFontStyle, handleAgentFontChange}
            size="sm"
            aria-label={m.settings_font_agentChat_label()}
            class="ml-4 shrink-0"
          >
            {#each fontStyleOptions as option (option.value)}
              <ToggleGroup.Item value={option.value} {...keepToggleSelected}>
                {option.label}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
        </SettingsFieldRow>
      </section>
    {/if}
    {#if show('code-font')}
      <section
        id="code-font"
        data-highlight-id="code-font"
        use:highlightTarget
        data-slot="settings-section-body"
        class="px-6 py-4"
      >
        <SettingsFieldRow
          id="settings-font-code-label-field"
          label={m.settings_font_code_label()}
          description={m.settings_font_code_description()}
        >
          {#snippet control({ labelId, descriptionId })}
            <div class="w-45 max-w-full flex-shrink-0">
              <FontPicker
                value={$codeFontFamily}
                options={$codeFontOptions}
                fontFamily={$codeFontFamilyCSS}
                ariaLabelledby={labelId}
                ariaDescribedby={descriptionId}
                onchange={handleCodeFontChange}
              />
            </div>
          {/snippet}
        </SettingsFieldRow>
      </section>
    {/if}
  </div>
</div>
