<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Portal from '$lib/components/ui/Portal.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import {
    faXmark,
    faTerminal,
    faCode,
    faCodeBranch,
    faExclamationTriangle,
    faChevronDown,
    faArrowUpRightFromSquare,
    faFolder,
  } from '@fortawesome/free-solid-svg-icons';
  import { onMount } from 'svelte';
  import {
    installedEditorsStore,
    type InstalledEditor,
  } from '$lib/stores/installed-editors.store.svelte';
  import { invoke } from '$lib/electron-bridge';
  import { createLogger } from '$lib/utils/client-logger';

  // Icon components for well-known editors
  import CursorCodeIcon from '$lib/components/shared/icons/CursorCodeIcon.svelte';
  import GhosttyIcon from '$lib/components/shared/icons/GhosttyIcon.svelte';
  import JetBrainsIcon from '$lib/components/shared/icons/JetBrainsIcon.svelte';
  import TerminalIcon from '$lib/components/shared/icons/TerminalIcon.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import WarpIcon from '$lib/components/shared/icons/WarpIcon.svelte';
  import XcodeIcon from '$lib/components/shared/icons/XcodeIcon.svelte';

  const logger = createLogger('PullConflictDialog');

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

  /** Types of pull errors for determining the appropriate resolution prompt */
  export type PullErrorType = 'unstaged-changes' | 'stash-conflict' | 'merge-conflict' | 'unknown';

  interface Props {
    open?: boolean;
    error?: string;
    repoPath?: string;
    branchName?: string;
    onCreateWorkspace?: (options?: { resolveConflicts?: boolean; errorType?: PullErrorType }) => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    error = '',
    repoPath = '',
    branchName = '',
    onCreateWorkspace,
    onCancel,
  }: Props = $props();

  // Dropdown open state
  let dropdownOpen = $state(false);

  // Fetch installed editors on mount
  onMount(() => {
    installedEditorsStore.fetch();
  });

  // Get all installed editors (combined IDEs and terminals)
  const installedEditors = $derived(installedEditorsStore.editors.filter((e) => e.installed));

  /**
   * Detect the type of pull error based on the error message
   */
  function detectErrorType(errorMsg: string): PullErrorType {
    const lowerError = errorMsg.toLowerCase();

    // Stash conflict - pull succeeded but stash pop failed
    if (
      lowerError.includes('stash') &&
      (lowerError.includes('conflict') || lowerError.includes('changes are saved in the stash'))
    ) {
      return 'stash-conflict';
    }

    // Unstaged changes error
    if (
      lowerError.includes('unstaged changes') ||
      lowerError.includes('please commit or stash them')
    ) {
      return 'unstaged-changes';
    }

    // Merge/rebase conflict
    if (lowerError.includes('conflict') || lowerError.includes('merge')) {
      return 'merge-conflict';
    }

    return 'unknown';
  }

  /** Detected error type based on the error message */
  const errorType = $derived(detectErrorType(error));

  function close() {
    open = false;
    onCancel?.();
  }

  /**
   * Open the repository in a specific editor based on its handler type.
   * Logic adapted from WorkspaceActionsMenu.svelte.
   */
  async function openInEditor(editor: InstalledEditor) {
    if (!repoPath) return;

    try {
      switch (editor.handlerType) {
        case 'finder':
          await invoke('shell:showItemInFolder', { path: repoPath });
          break;
        case 'vscode':
          await invoke('vscode:open', repoPath);
          break;
        case 'jetbrains':
          await invoke('jetbrains:open', repoPath);
          break;
        case 'xcode':
          await invoke('xcode:open', { folder: repoPath });
          break;
        case 'generic':
        default:
          await invoke('external-editors:open', { editorId: editor.id, path: repoPath });
          break;
      }
      open = false;
      onCancel?.();
    } catch (err) {
      logger.error(`Failed to open in ${editor.appName}:`, err);
    }
  }

  function handleCreateWorkspace() {
    open = false;
    onCreateWorkspace?.({ resolveConflicts: true, errorType });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

{#if open}
  <Portal>
    <div
      class="bg-black/50 flex items-center justify-center w-screen h-screen fixed inset-0"
      role="button"
      tabindex="0"
      onkeydown={handleKeydown}
      onclick={close}
    >
      <div
        class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        tabindex="-1"
        onkeydown={(e) => {
          // Only stop propagation for Tab (focus trap behavior)
          // Let Escape through so the backdrop handler can close the dialog
          if (e.key === 'Tab') {
            e.stopPropagation();
          }
        }}
      >
        <!-- Header -->
        <div class="px-6 py-4 border-b border-border flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="text-destructive-foreground">
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
            <div>
              <h2 class="text-lg font-semibold">Pull Failed</h2>
              {#if branchName}
                <p class="text-sm text-subtle mt-0.5">Branch: {branchName}</p>
              {/if}
            </div>
          </div>
          <Button variant="ghost" size="icon" onclick={close}>
            <Fa icon={faXmark} />
          </Button>
        </div>

        <!-- Content -->
        <div class="p-6">
          <p class="text-sm text-subtle mb-4">
            Unable to pull changes from the remote branch. This usually happens when there are local
            changes that conflict with remote changes.
          </p>
          {#if error}
            <div
              class="bg-destructive/10 py-2.5 px-3.5 text-sm text-destructive-foreground whitespace-pre-wrap break-words max-h-32 overflow-auto"
            >
              {error}
            </div>
          {/if}
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-border flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-2 items-center">
            <p class="text-xs select-none">Resolve conflicts in another app</p>
            <!-- Open in dropdown (combined IDEs and terminals) -->
            {#if installedEditors.length > 0}
              <DropdownMenu bind:open={dropdownOpen} align="start" portal={true}>
                {#snippet trigger({ toggle }: { toggle: () => void })}
                  <Button variant="outline" onclick={toggle} class="w-full justify-between gap-2">
                    <span class="flex items-center gap-2">
                      <Fa icon={faArrowUpRightFromSquare} size="sm" />
                      <span>Open in...</span>
                    </span>
                    <Fa icon={faChevronDown} size="xs" class="opacity-50" />
                  </Button>
                {/snippet}

                {#snippet content()}
                  <div class="max-w-60 py-1">
                    {#each installedEditors as editor (editor.id)}
                      {@const IconComponent = EDITOR_ICONS[editor.id]}
                      <button
                        type="button"
                        class="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left cursor-pointer"
                        onclick={() => {
                          openInEditor(editor);
                          dropdownOpen = false;
                        }}
                      >
                        {#if editor.iconBase64}
                          <img
                            src="data:image/png;base64,{editor.iconBase64}"
                            alt={editor.name}
                            class="w-5 h-5"
                          />
                        {:else if IconComponent}
                          <IconComponent size={16} />
                        {:else if editor.category === 'terminal'}
                          <Fa icon={faTerminal} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
                        {:else if editor.category === 'finder'}
                          <Fa icon={faFolder} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
                        {:else}
                          <Fa icon={faCode} class="w-4 h-4 ml-0.5 mr-0.5 opacity-30" />
                        {/if}
                        <span class="flex-1">{editor.name}</span>
                      </button>
                    {/each}
                  </div>
                {/snippet}
              </DropdownMenu>
            {/if}
          </div>
          <div class="grid grid-cols-2 gap-2 items-center">
            <Tooltip
              content="Create a new workspace on the target with an agent to resolve the conflicts"
            >
              <span class="text-xs inline-block">Or let Intent handle it</span>
            </Tooltip>
            <!-- Create workspace action -->
            <Button
              variant="default"
              onclick={handleCreateWorkspace}
              class="w-full justify-start gap-2"
            >
              <Fa icon={faCodeBranch} />
              Create Workspace
            </Button>
          </div>
        </div>
      </div>
    </div>
  </Portal>
{/if}
