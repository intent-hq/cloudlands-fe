<script lang="ts">
  import CursorCodeIcon from '$lib/components/shared/icons/CursorCodeIcon.svelte';
  import GhosttyIcon from '$lib/components/shared/icons/GhosttyIcon.svelte';
  import JetBrainsIcon from '$lib/components/shared/icons/JetBrainsIcon.svelte';
  import TerminalIcon from '$lib/components/shared/icons/TerminalIcon.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import WarpIcon from '$lib/components/shared/icons/WarpIcon.svelte';
  import XcodeIcon from '$lib/components/shared/icons/XcodeIcon.svelte';
  import { SettingsFieldRow } from '$lib/components/ui/settings-field-row';
  import { Toggle } from '$lib/components/ui/toggle';
  import {
    selectHiddenEditorIds,
    selectInstalledEditors,
  } from '$store/renderer/slices/external-editors/external-editors-selectors';
  import {
    fetchEditors,
    toggleHiddenEditor,
    type InstalledEditor,
  } from '$store/renderer/slices/external-editors/external-editors-slice';

  import { faCode, faFolder, faTerminal } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  const installedEditors$ = selectInstalledEditors();
  const hiddenEditorIds$ = selectHiddenEditorIds();

  const EDITOR_ICONS: Record<string, typeof VSCodeIcon> = {
    vscode: VSCodeIcon,
    cursor: CursorCodeIcon,
    jetbrains: JetBrainsIcon,
    xcode: XcodeIcon,
    warp: WarpIcon,
    ghostty: GhosttyIcon,
    terminal: TerminalIcon,
  };

  const installedEditors = $derived($installedEditors$.filter((editor) => editor.installed));

  onMount(() => {
    appStore.dispatch(fetchEditors());
  });

  function isEditorEnabled(editorId: string) {
    return !$hiddenEditorIds$.includes(editorId);
  }

  function handleEditorToggle(editorId: string, enabled: boolean) {
    if (isEditorEnabled(editorId) !== enabled) {
      appStore.dispatch(toggleHiddenEditor(editorId));
    }
  }

  function getEditorIcon(editor: InstalledEditor) {
    return EDITOR_ICONS[editor.id] || null;
  }
</script>

<div class="min-w-0 space-y-1" data-open-in-apps>
  {#if installedEditors.length === 0}
    <p class="type-body py-3 text-muted-foreground">{m.settings_openInApps_empty()}</p>
  {:else}
    {#each installedEditors as editor (editor.id)}
      <SettingsFieldRow
        id={`open-in-${editor.id}`}
        label={editor.name}
        class="py-2.5 first:pt-2.5 last:pb-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-4"
      >
        {#snippet leading()}
          <div
            class="flex size-8 items-center justify-center overflow-hidden rounded-(--radius-small) bg-muted/50 text-muted-foreground"
          >
            {#if editor.iconBase64}
              <img src="data:image/png;base64,{editor.iconBase64}" alt="" class="size-5" />
            {:else if getEditorIcon(editor)}
              {@const Icon = getEditorIcon(editor)}
              <Icon size={16} />
            {:else if editor.category === 'terminal'}
              <Fa icon={faTerminal} class="w-4 h-4 opacity-60" />
            {:else if editor.category === 'finder'}
              <Fa icon={faFolder} class="w-4 h-4 opacity-60" />
            {:else}
              <Fa icon={faCode} class="w-4 h-4 opacity-60" />
            {/if}
          </div>
        {/snippet}
        {#snippet control()}
          <Toggle
            pressed={isEditorEnabled(editor.id)}
            onChange={(pressed) => handleEditorToggle(editor.id, pressed === true)}
            size="xs"
            ariaLabel={editor.name}
          />
        {/snippet}
      </SettingsFieldRow>
    {/each}
  {/if}
</div>
