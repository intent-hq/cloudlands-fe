<script lang="ts">
  import type { Snippet } from 'svelte';
  import CursorCodeIcon from '$lib/components/shared/icons/CursorCodeIcon.svelte';
  import GhosttyIcon from '$lib/components/shared/icons/GhosttyIcon.svelte';
  import JetBrainsIcon from '$lib/components/shared/icons/JetBrainsIcon.svelte';
  import TerminalIcon from '$lib/components/shared/icons/TerminalIcon.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import WarpIcon from '$lib/components/shared/icons/WarpIcon.svelte';
  import XcodeIcon from '$lib/components/shared/icons/XcodeIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { toast } from '$lib/components/ui/toast';
  import { invoke } from '$lib/electron-bridge';
  import {
    fetchEditors,
    setOpenAction,
    type InstalledEditor,
    type OpenAction,
  } from '$lib/store/slices/external-editors/external-editors-slice';
  import {
    selectInstalledEditors,
    selectOpenAction,
  } from '$lib/store/slices/external-editors/external-editors-selectors';
  import { getDispatch } from '$lib/store/utils/utils';
  import { createLogger } from '$lib/utils/client-logger';
  import { toNativePath } from '$lib/utils/path-utils';
  import {
    faArrowUpRightFromSquare,
    faChevronDown,
    faCode,
    faCodeBranch,
    faCopy,
    faEllipsisH,
    faFolder,
    faFolderOpen,
    faTerminal,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  const logger = createLogger('OpenComboButton');

  /** Icon mapping from editor ID to Svelte component */
  const EDITOR_ICONS: Record<string, typeof VSCodeIcon> = {
    vscode: VSCodeIcon,
    cursor: CursorCodeIcon,
    jetbrains: JetBrainsIcon,
    xcode: XcodeIcon,
    warp: WarpIcon,
    ghostty: GhosttyIcon,
    terminal: TerminalIcon,
  };

  interface ActionConfig {
    id: OpenAction;
    label: string;
    shortLabel: string;
    icon: typeof VSCodeIcon | null;
    faIcon?: typeof faCopy;
    shortcut?: string;
    description?: string;
    handlerType?: 'generic' | 'vscode' | 'jetbrains' | 'xcode' | 'finder';
    appName?: string;
    category?: 'ide' | 'terminal' | 'finder';
    /** Base64-encoded PNG icon extracted from the app bundle */
    iconBase64?: string;
    children?: Snippet;
  }

  interface Props {
    filePath: string;
    isDirectory?: boolean;
    /** The workspace/folder path to open first before the file. Required for proper editor context when isDirectory=false */
    workspaceFolderPath?: string;
    class?: string;
    headerText?: string;
    /** Set to false when used inside portaled elements like toasts to avoid z-index issues */
    usePortal?: boolean;
    /** Direction to expand the dropdown */
    side?: 'top' | 'bottom';
    /** Background variant - 'default' uses background, 'sidebar' uses sidebar color */
    variant?: 'default' | 'sidebar';
    /** Optional branch name for copy branch action */
    branchName?: string;
    /** Compact mode - shows only an external link icon instead of full button */
    compact?: boolean;
    children?: Snippet;
  }

  let {
    filePath,
    isDirectory = true,
    workspaceFolderPath,
    class: className = '',
    headerText,
    usePortal = true,
    side = 'bottom',
    variant = 'default',
    branchName,
    compact = false,
    children = undefined,
  }: Props = $props();

  const bgClass = $derived(
    variant === 'sidebar' ? 'bg-sidebar hover:bg-sidebar/80' : 'bg-background hover:bg-muted',
  );

  const dispatch = getDispatch();
  const openAction = selectOpenAction();
  const installedEditors$ = selectInstalledEditors();

  let dropdownOpen = $state(false);

  // Fetch installed editors when component mounts
  $effect(() => {
    dispatch(fetchEditors());
  });

  /** Convert installed editor to action config */
  function editorToAction(editor: InstalledEditor): ActionConfig {
    return {
      id: editor.id,
      label: editor.name,
      shortLabel: editor.shortLabel,
      icon: EDITOR_ICONS[editor.id] || null,
      shortcut: editor.shortcut,
      handlerType: editor.handlerType,
      appName: editor.appName,
      category: editor.category,
      iconBase64: editor.iconBase64,
    };
  }

  // Build actions from installed editors dynamically
  let actions: ActionConfig[] = $derived.by(() => {
    const installedEditors = $installedEditors$;

    // Convert installed editors to action configs, sorted by priority
    const editorActions: ActionConfig[] = installedEditors
      .filter((e) => e.installed)
      .map(editorToAction);

    // Add "Other..." option to pick any app
    const otherAction: ActionConfig = {
      id: 'other' as OpenAction,
      label: 'Other',
      shortLabel: 'Other',
      icon: null,
      faIcon: faFolderOpen,
      handlerType: 'generic',
    };

    // Add special actions (copy, copy-branch)
    const specialActions: ActionConfig[] = [
      {
        id: 'copy',
        label: 'Copy path',
        shortLabel: 'Copy',
        icon: null,
        faIcon: faCopy,
        // shortcut: '⌘⇧C',
      },
      ...(branchName
        ? [
            {
              id: 'copy-branch' as const,
              label: 'Copy branch name',
              shortLabel: 'Branch',
              icon: null,
              faIcon: faCodeBranch,
            },
          ]
        : []),
    ];

    return [...editorActions, otherAction, ...specialActions];
  });

  const currentAction = $derived(
    actions.find((a) => a.id === $openAction) || actions[0],
  );

  /**
   * Get the path to open for editors (VSCode, Cursor, JetBrains, Xcode).
   * Returns either a string (for directories) or { folder, file } object for proper workspace context.
   */
  function getEditorPath(): string | { folder: string; file: string } {
    if (isDirectory) {
      // For directories, just open the directory
      return filePath;
    }

    // For files, we need workspace context
    const folderPath = workspaceFolderPath || filePath.substring(0, filePath.lastIndexOf('/'));
    if (folderPath) {
      return { folder: folderPath, file: filePath };
    }

    // Fallback: just open the file
    return filePath;
  }

  async function executeAction(actionId: OpenAction) {
    if (!filePath) return;

    const targetPath = isDirectory ? filePath : filePath.substring(0, filePath.lastIndexOf('/'));

    try {
      // Handle special actions first
      if (actionId === 'copy') {
        await navigator.clipboard.writeText(toNativePath(filePath));
        toast.success('Path copied to clipboard');
        return;
      }
      if (actionId === 'copy-branch') {
        if (branchName) {
          await navigator.clipboard.writeText(branchName);
          toast.success('Branch name copied to clipboard');
        }
        return;
      }
      if (actionId === 'other') {
        // Open with user-selected app (shows file picker)
        const result = await invoke<{ success: boolean; appName?: string; error?: string }>(
          'external-editors:open-with-other',
          { path: targetPath },
        );
        if (result?.success) {
          dropdownOpen = false;
        }
        return;
      }

      // Find the action config to get handler info
      const action = actions.find((a) => a.id === actionId);
      if (!action) {
        logger.warn(`Unknown action: ${actionId}`);
        return;
      }

      // Route to appropriate handler based on handlerType
      switch (action.handlerType) {
        case 'finder':
          await invoke('shell:showItemInFolder', { path: targetPath });
          break;
        case 'vscode':
          await invoke('vscode:open', getEditorPath());
          break;
        case 'jetbrains':
          await invoke('jetbrains:open', getEditorPath());
          break;
        case 'xcode':
          await invoke('xcode:open', getEditorPath());
          break;
        case 'generic':
        default: {
          // Generic handler uses external-editors:open IPC
          await invoke('external-editors:open', { editorId: action.id, path: targetPath });
          break;
        }
      }
    } catch (error) {
      logger.error(`Failed to execute action ${actionId}:`, error);
    }
  }

  function handlePrimaryClick() {
    executeAction($openAction);
  }

  function handleActionClick(actionId: OpenAction) {
    dispatch(setOpenAction(actionId));
    executeAction(actionId);
    dropdownOpen = false;
  }

  // Remove global keyboard shortcuts - these are now handled by the sidebar
  // to prevent duplicate toasts when multiple OpenComboButton instances exist
</script>

<div class="inline-flex items-center {className}">
  <DropdownMenu bind:open={dropdownOpen} align="end" portal={usePortal} {side}>
    {#snippet trigger({ toggle }: { toggle: () => void })}
      {#if children}
        <button
          type="button"
          onclick={toggle}
          class="cursor-pointer"
          title="Open in {currentAction.label}"
        >
          {@render children()}
        </button>
      {:else if compact}
        <!-- Compact mode: single icon button with dropdown -->
        <Button
          variant="ghost-light"
          size="icon-xs"
          onclick={toggle}
          tooltip="Open in..."
          tooltipSide="bottom"
        >
          <Fa icon={faArrowUpRightFromSquare} size="xs" />
        </Button>
      {:else}
        <!-- Full mode: icon + "Open" text + dropdown chevron -->
        <div
          class="inline-flex gap-px items-stretch rounded-md borderx border-border overflow-hidden"
        >
          <button
            type="button"
            class="flex items-center gap-1.5 px-2 py-1 text-xs {bgClass} transition-colors cursor-pointer"
            onclick={handlePrimaryClick}
            title="Open in {currentAction.label}"
          >
            {#if currentAction.iconBase64}
              <img
                src="data:image/png;base64,{currentAction.iconBase64}"
                alt={currentAction.label}
                class="w-4 h-4"
              />
            {:else if currentAction.icon}
              {@const Icon = currentAction.icon}
              <Icon size={14} />
            {:else if currentAction.faIcon}
              <Fa icon={currentAction.faIcon} class="w-3.5 h-3.5 opacity-60" />
            {:else if currentAction.category === 'terminal'}
              <Fa icon={faTerminal} class="w-3.5 h-3.5 opacity-60" />
            {:else if currentAction.category === 'finder'}
              <Fa icon={faFolder} class="w-3.5 h-3.5 opacity-60" />
            {:else}
              <Fa icon={faCode} class="w-3.5 h-3.5 opacity-60" />
            {/if}
            <span class="text-subtle">Open</span>
          </button>
          <button
            type="button"
            class="flex items-center h-full min-h-full px-1.5 py-2 {bgClass} border-lx border-border transition-colors cursor-pointer"
            onclick={toggle}
          >
            <Fa icon={faChevronDown} class="w-2! h-2! text-ghost" />
          </button>
        </div>
      {/if}
    {/snippet}

    {#snippet content()}
      <div class="max-w-60">
        {#if headerText}
          <div class="px-2 py-1.5 text-sm text-subtle">
            {headerText}
          </div>
        {/if}
        <!-- <div class="w-full h-px bg-border mb-1"></div> -->
        {#each actions as action (action.id)}
          {#if action.id === 'copy'}
            <!-- <div class="my-1 w-full h-px bg-border"></div> -->
          {/if}
          <button
            type="button"
            class="flex flex-col w-full px-2 py-1.5 text-sm hover:bg-muted transition-colors text-left cursor-pointer"
            onclick={() => handleActionClick(action.id)}
          >
            <div class="w-full flex items-center gap-2">
              {#if action.iconBase64}
                <!-- Use dynamic icon extracted from app bundle -->
                <img
                  src="data:image/png;base64,{action.iconBase64}"
                  alt={action.label}
                  class="w-5 h-5"
                />
              {:else if action.icon}
                {@const Icon = action.icon}
                <Icon size={16} />
              {:else if action.faIcon}
                <Fa icon={action.faIcon} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
              {:else if action.category === 'terminal'}
                <Fa icon={faTerminal} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
              {:else if action.category === 'finder'}
                <Fa icon={faFolder} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
              {:else}
                <Fa icon={faCode} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
              {/if}
              <span class="flex-1">{action.label}</span>
              {#if action.shortcut}
                <span class="text-xs text-subtle">{action.shortcut}</span>
              {/if}
            </div>
            {#if action.description}
              <div
                class="w-full pt-2 pb-1.5 px-0.5 font-mxono whitespace-break-spaces break-words text-xs text-subtle truncate"
                title={action.description}
              >
                {action.description}
              </div>
            {/if}
          </button>
        {/each}
      </div>
    {/snippet}
  </DropdownMenu>
</div>
