<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
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
    fetchEditors,
    type InstalledEditor,
  } from '$store/renderer/slices/external-editors/external-editors-slice';
  import { selectInstalledEditorsFiltered } from '$store/renderer/slices/external-editors/external-editors-selectors';

  import { invoke } from '$lib/electron-bridge';
  import { toast } from 'svelte-sonner';
  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';

  // Icon components for well-known editors
  import CursorCodeIcon from '$lib/components/shared/icons/CursorCodeIcon.svelte';
  import GhosttyIcon from '$lib/components/shared/icons/GhosttyIcon.svelte';
  import JetBrainsIcon from '$lib/components/shared/icons/JetBrainsIcon.svelte';
  import TerminalIcon from '$lib/components/shared/icons/TerminalIcon.svelte';
  import VSCodeIcon from '$lib/components/shared/icons/VSCodeIcon.svelte';
  import WarpIcon from '$lib/components/shared/icons/WarpIcon.svelte';
  import XcodeIcon from '$lib/components/shared/icons/XcodeIcon.svelte';
  import { store as appStore } from '$store/renderer/store';

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
    onCreateWorkspace?: (options?: {
      resolveConflicts?: boolean;
      errorType?: PullErrorType;
    }) => void;
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

  const installedEditors$ = selectInstalledEditorsFiltered();

  // Dropdown open state
  let dropdownOpen = $state(false);

  // Fetch installed editors on mount
  onMount(() => {
    console.log('PullConflictDialog mounted, fetching installed editors');
    appStore.dispatch(fetchEditors());
  });

  // Get all installed editors (combined IDEs and terminals)

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
    dropdownOpen = false;
    open = false;
    onCancel?.();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && open) close();
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
      toast.error(
        err instanceof Error
          ? err.message
          : m.modals_pullConflict_openFailed_error({ appName: editor.appName }),
      );
    }
  }

  function handleCreateWorkspace() {
    open = false;
    onCreateWorkspace?.({ resolveConflicts: true, errorType });
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  <Dialog.Content
    data-pull-conflict-dialog
    showCloseButton={false}
    class="app-no-drag max-w-md gap-0 overflow-hidden rounded-lg p-0"
  >
    <!-- Header -->
    <div class="px-6 py-4 border-b border-border flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="text-danger">
          <Fa icon={faExclamationTriangle} size="lg" />
        </div>
        <div>
          <Dialog.Title class="text-lg font-semibold">
            {m.modals_pullConflict_title()}
          </Dialog.Title>
          {#if branchName}
            <p class="text-sm text-subtle mt-0.5">
              {m.modals_pullConflict_branch_label({ branchName })}
            </p>
          {/if}
        </div>
      </div>
      <Dialog.Close
        class="app-no-drag inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-foreground outline-none transition-[background-color,border-color,color,box-shadow] hover:border-border hover:bg-secondary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label={m.modals_pullConflict_close_ariaLabel()}
      >
        <Fa icon={faXmark} />
      </Dialog.Close>
    </div>

    <!-- Content -->
    <div class="p-6">
      <Dialog.Description class="text-sm text-subtle mb-4">
        {m.modals_pullConflict_description()}
      </Dialog.Description>
      {#if error}
        <div
          class="bg-danger-background/10 py-2.5 px-3.5 text-sm text-danger whitespace-pre-wrap break-words max-h-32 overflow-auto"
        >
          {error}
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="px-6 py-4 border-t border-border flex flex-col gap-3">
      <div class="grid grid-cols-2 gap-2 items-center">
        <p class="text-xs select-none">{m.modals_pullConflict_resolveInApp_label()}</p>
        <!-- Open in dropdown (combined IDEs and terminals) -->
        {#if $installedEditors$.length > 0}
          <DropdownMenu bind:open={dropdownOpen} align="start" portal={true}>
            {#snippet trigger({ props })}
              <Button {...props} variant="outline" class="w-full justify-between gap-2">
                <span class="flex items-center gap-2">
                  <Fa icon={faArrowUpRightFromSquare} size="sm" />
                  <span>{m.modals_pullConflict_openIn_label()}</span>
                </span>
                <Fa icon={faChevronDown} size="xs" class="opacity-50" />
              </Button>
            {/snippet}

            {#snippet content()}
              <div class="max-w-60 py-1">
                {#each $installedEditors$ as editor (editor.id)}
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
        <Tooltip content={m.modals_pullConflict_createWorkspace_tooltip()}>
          <span class="text-xs inline-block">{m.modals_pullConflict_letIntentHandle_label()}</span>
        </Tooltip>
        <!-- Create workspace action -->
        <Button
          variant="default"
          onclick={handleCreateWorkspace}
          class="w-full justify-start gap-2"
        >
          <Fa icon={faCodeBranch} />
          {m.modals_pullConflict_createWorkspace_label()}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  :global(body:has([data-pull-conflict-dialog]) [data-slot='dialog-overlay']) {
    z-index: 10000 !important;
    -webkit-app-region: no-drag;
  }

  :global(body:has([data-pull-conflict-dialog]) [data-slot='dialog-content']) {
    z-index: 10001 !important;
    -webkit-app-region: no-drag;
  }

  :global(body:has([data-pull-conflict-dialog]) [data-slot='menu-content']) {
    z-index: 10002 !important;
  }
</style>
