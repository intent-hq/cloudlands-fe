<script lang="ts">
  import { Dropdown, type DropdownOption } from '$lib/components/ui/dropdown';
  import {
    noteFontSettings,
    type NoteFontStyle,
  } from '$lib/stores/note-font-settings.store.svelte';
  import { noteSpellcheckSettings } from '$lib/stores/note-spellcheck-settings.store.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { setOpenAction, type OpenAction } from '$lib/store/slices/open-action/open-action-slice';
  import { getDispatch } from '$lib/store/utils/utils';
  import { toast } from '$lib/components/ui/toast';
  import { createLogger } from '$lib/utils/client-logger';
  import Fa from 'svelte-fa';
  import {
    faEllipsisVertical,
    faTrash,
    faFont,
    faArrowUpRightFromSquare,
    faSpellCheck,
  } from '@fortawesome/free-solid-svg-icons';

  const logger = createLogger('NoteActionsDropdown');

  interface Props {
    /** File path of the note (for Open in... actions) */
    noteFilePath?: string;
    /** Whether this is the spec note (cannot be deleted) */
    isSpec?: boolean;
    /** Callback when delete is requested */
    onDelete?: () => void;
  }

  let {
    noteFilePath,
    isSpec = false,
    onDelete,
  }: Props = $props();

  const dispatch = getDispatch();

  let dropdownOpen = $state(false);

  // Font style options (only sans and monospace are supported)
  const fontStyleOptions: { value: NoteFontStyle; label: string }[] = [
    { value: 'sans', label: 'Sans-serif' },
    { value: 'monospace', label: 'Monospace' },
  ];

  // Open in actions
  const openInActions: { id: OpenAction; label: string; shortcut?: string }[] = [
    { id: 'finder', label: 'Finder', shortcut: '⌘O' },
    { id: 'vscode', label: 'VS Code' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'jetbrains', label: 'JetBrains' },
    { id: 'xcode', label: 'Xcode' },
    { id: 'warp', label: 'Warp' },
    { id: 'ghostty', label: 'Ghostty' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'copy', label: 'Copy path', shortcut: '⌘⇧C' },
  ];

  // Build dropdown options
  const dropdownOptions = $derived.by((): DropdownOption[] => {
    const options: DropdownOption[] = [];

    // Font style submenu
    options.push({
      value: 'font-style',
      label: 'Font style',
      icon: faFont,
      type: 'submenu',
      children: fontStyleOptions.map((style) => ({
        value: `font:${style.value}`,
        label: style.label,
        onclick: () => {
          noteFontSettings.fontStyle = style.value;
          dropdownOpen = false;
        },
        endLabel: noteFontSettings.fontStyle === style.value ? '✓' : undefined,
      })),
    });

    // Spellcheck toggle
    options.push({
      value: 'spellcheck',
      label: 'Spellcheck',
      icon: faSpellCheck,
      type: 'toggle',
      checked: noteSpellcheckSettings.enabled,
      onclick: () => {
        noteSpellcheckSettings.toggle();
      },
    });

    // Open in submenu (only if noteFilePath is provided)
    if (noteFilePath) {
      options.push({
        value: 'open-in',
        label: 'Open in...',
        icon: faArrowUpRightFromSquare,
        type: 'submenu',
        children: openInActions.map((action) => ({
          value: `open:${action.id}`,
          label: action.label,
          shortcut: action.shortcut,
          onclick: () => executeOpenAction(action.id),
        })),
      });
    }

    // Separator before danger zone
    if (!isSpec) {
      options.push({ value: 'sep-danger', label: '', type: 'separator' });
      options.push({
        value: 'delete',
        label: 'Delete note',
        icon: faTrash,
        class: 'text-destructive-foreground hover:bg-destructive/10',
        onclick: () => {
          onDelete?.();
          dropdownOpen = false;
        },
      });
    }

    return options;
  });

  async function executeOpenAction(actionId: OpenAction) {
    if (!noteFilePath) return;
    dropdownOpen = false;

    try {
      switch (actionId) {
        case 'finder':
          await invoke('shell:showItemInFolder', { path: noteFilePath });
          break;
        case 'vscode':
          await invoke('vscode:open', noteFilePath);
          break;
        case 'cursor':
          await invoke('system:execute-command', {
            command: `open -a Cursor "${noteFilePath}"`,
          });
          break;
        case 'jetbrains':
          await invoke('jetbrains:open', noteFilePath);
          break;
        case 'xcode':
          await invoke('xcode:open', noteFilePath);
          break;
        case 'warp':
          await invoke('system:execute-command', {
            command: `open -a Warp "${noteFilePath}"`,
          });
          break;
        case 'terminal':
          await invoke('system:execute-command', {
            command: `open -a Terminal "${noteFilePath}"`,
          });
          break;
        case 'ghostty':
          await invoke('system:execute-command', {
            command: `open -a Ghostty "${noteFilePath}"`,
          });
          break;
        case 'copy':
          await navigator.clipboard.writeText(noteFilePath);
          toast.success('Path copied to clipboard');
          break;
      }
      dispatch(setOpenAction(actionId));
    } catch (error) {
      logger.error(`Failed to execute action ${actionId}:`, error);
    }
  }

</script>
<Dropdown
  bind:open={dropdownOpen}
  options={dropdownOptions}
  searchable={false}
  portal
  variant="ghost"
  size="xs"
  triggerClass="h-7 w-7 p-0 justify-center"
  contentClass="min-w-[200px]"
>
  {#snippet trigger(_triggerProps)}
    <Fa icon={faEllipsisVertical} class="h-3.5 w-3.5 text-ghost" />
  {/snippet}
</Dropdown>
