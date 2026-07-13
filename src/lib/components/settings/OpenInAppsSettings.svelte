<script lang="ts">
  import CursorCodeIcon from '$lib/components/shared/icons/CursorCodeIcon.svelte';
  import GhosttyIcon from '$lib/components/shared/icons/GhosttyIcon.svelte';
  import JetBrainsIcon from '$lib/components/shared/icons/JetBrainsIcon.svelte';
  import TerminalIcon from '$lib/components/shared/icons/TerminalIcon.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import WarpIcon from '$lib/components/shared/icons/WarpIcon.svelte';
  import XcodeIcon from '$lib/components/shared/icons/XcodeIcon.svelte';
  import Toggle from '$lib/components/ui/toggle/toggle.svelte';
  import {
  selectHiddenEditorIds,
  selectInstalledEditors,
} from '$store/renderer/slices/external-editors/external-editors-selectors';
  import {
  fetchEditors,
  toggleHiddenEditor,
  type InstalledEditor,
} from '$store/renderer/slices/external-editors/external-editors-slice';

  import {
  faCode,
  faFolder,
  faTerminal,
} from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import Fa from 'svelte-fa';
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

  function handleEditorToggle(editorId: string, value: string | boolean) {
    const enabled = value === true;
    if (isEditorEnabled(editorId) !== enabled) {
      appStore.dispatch(toggleHiddenEditor(editorId));
    }
  }

  function getEditorIcon(editor: InstalledEditor) {
    return EDITOR_ICONS[editor.id] || null;
  }
</script>

<div class="flex flex-col gap-1">
  {#if installedEditors.length === 0}
    <p class="text-sm text-subtle">No installed Open In apps detected.</p>
  {:else}
    {#each installedEditors as editor (editor.id)}
      <div class="flex items-center justify-between gap-4 py-2">
        <div class="flex items-center gap-3 min-w-0">
          {#if editor.iconBase64}
            <img src="data:image/png;base64,{editor.iconBase64}" alt={editor.name} class="w-5 h-5" />
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
          <span class="text-sm font-medium text-foreground truncate">{editor.name}</span>
        </div>
        <Toggle
          variant="switch"
          pressed={isEditorEnabled(editor.id)}
          onChange={(value) => handleEditorToggle(editor.id, value)}
          size="xs"
          ariaLabel={`Show ${editor.name} in Open In`}
        />
      </div>
    {/each}
  {/if}
</div>
