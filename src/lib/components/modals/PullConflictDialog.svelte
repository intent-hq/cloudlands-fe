<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import Fa from 'svelte-fa';
  import {
    faTerminal,
    faCode,
    faCodeBranch,
    faChevronDown,
    faArrowUpRightFromSquare,
    faFolder,
  } from '@fortawesome/free-solid-svg-icons';
  import { untrack } from 'svelte';
  import { readable } from 'svelte/store';
  import { onMount } from 'svelte';
  import {
    fetchEditors,
    type InstalledEditor,
  } from '$store/renderer/slices/external-editors/external-editors-slice';
  import { selectInstalledEditorsFiltered } from '$store/renderer/slices/external-editors/external-editors-selectors';

  import { invoke } from '$lib/electron-bridge';
  import { notify } from '$lib/components/patterns/notify';
  import { createLogger } from '$lib/utils/client-logger';
  import { acquireMarkerAttribute } from '$lib/utils/marker-attribute-lease';
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
    static?: boolean;
    staticData?: { editors: InstalledEditor[] };
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
    static: staticPosition = false,
    staticData,
    error = '',
    repoPath = '',
    branchName = '',
    onCreateWorkspace,
    onCancel,
  }: Props = $props();

  const installedEditors$ = untrack(() =>
    staticData ? readable(staticData.editors) : selectInstalledEditorsFiltered(),
  );

  // Dropdown open state
  let dropdownOpen = $state(false);
  let contentRef: HTMLElement | null = $state(null);

  // Mark <body> while the dialog content is mounted (including its outro) so the
  // layering rules below can key off an attribute. A `body:has(...)` anchor would
  // make every DOM/style mutation in the page a candidate `:has()` invalidation.
  // The marker is leased per instance: overlapping dialogs (onboarding + the
  // global create flow) keep it until the last one detaches.
  $effect(() => {
    if (staticPosition || !contentRef) return;
    const releaseBody = acquireMarkerAttribute(
      contentRef.ownerDocument.body,
      'data-pull-conflict-dialog-open',
    );
    const releaseMarker = acquireMarkerAttribute(contentRef, 'data-pull-conflict-dialog');
    return () => {
      releaseBody();
      releaseMarker();
    };
  });

  // Fetch installed editors on mount
  onMount(() => {
    if (staticData) return;
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
  const dialogTitle = $derived(
    errorType === 'stash-conflict'
      ? m.modals_pullConflict_stashTitle_label()
      : m.modals_pullConflict_title(),
  );
  const description = $derived(
    errorType === 'stash-conflict'
      ? branchName
        ? m.modals_pullConflict_stashBranch_description({ branchName })
        : m.modals_pullConflict_stash_description()
      : branchName
        ? m.modals_pullConflict_remoteBranch_description({ branchName })
        : m.modals_pullConflict_description(),
  );
  // Only simplify recognized content-conflict lines. Preserve every other
  // diagnostic verbatim, including unrecognized conflict kinds.
  const errorLines = $derived(
    error
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => ({
        raw: line,
        path: /^CONFLICT \(content\): Merge conflict in (.+)$/.exec(line)?.[1],
      })),
  );

  function close() {
    dropdownOpen = false;
    open = false;
    onCancel?.();
  }

  /**
   * Open the repository in a specific editor based on its handler type.
   * Logic adapted from WorkspaceActionsMenu.svelte.
   */
  async function openInEditor(editor: InstalledEditor) {
    if (staticData || !repoPath) return;

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
      notify.error(
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

<ContentDialog
  bind:open
  static={staticPosition}
  bind:contentRef
  title={dialogTitle}
  closeLabel={m.modals_pullConflict_close_ariaLabel()}
  onClose={close}
>
  <div class="min-w-0">
    <p class="type-body break-words">
      {description}
      <span
        >{errorLines
          .filter((line) => !line.path)
          .map((line) => line.raw)
          .join(' ')}</span
      >
    </p>
    {#if errorLines.some((line) => line.path)}
      <div class="mt-4 space-y-2 type-caption">
        <p class="text-subtle">{m.modals_pullConflict_conflictedFiles_label()}</p>
        <ul class="list-disc pl-4 space-y-1 max-h-40 overflow-auto">
          {#each errorLines.filter((line) => line.path) as line}
            <li class="[overflow-wrap:anywhere]">{line.path}</li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  <!-- Footer -->
  {#snippet footer()}
    <div class="flex w-full flex-col gap-4">
      {#if $installedEditors$.length > 0}<div class="grid grid-cols-2 gap-2 items-center">
          <p
            id="pull-conflict-editor-label"
            class="type-caption text-muted-foreground font-normal select-none"
          >
            {m.modals_pullConflict_resolveInApp_label()}
          </p>
          <!-- Open in dropdown (combined IDEs and terminals) -->
          {#if $installedEditors$.length > 0}
            <DropdownMenu bind:open={dropdownOpen} align="start" portal={true}>
              {#snippet trigger({ props })}
                <Button
                  {...props}
                  aria-labelledby="pull-conflict-editor-label"
                  variant="outline"
                  class="w-full justify-between gap-2"
                >
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
                    <Menu.Item
                      class="items-start whitespace-normal"
                      onSelect={() => {
                        openInEditor(editor);
                        dropdownOpen = false;
                      }}
                    >
                      <span class="first-line-icon">
                        {#if editor.iconBase64}
                          <img
                            src="data:image/png;base64,{editor.iconBase64}"
                            alt=""
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
                      </span>
                      <span data-editor-name class="min-w-0 flex-1 break-words">{editor.name}</span>
                    </Menu.Item>
                  {/each}
                </div>
              {/snippet}
            </DropdownMenu>
          {/if}
        </div>{/if}
      <div class="flex flex-wrap justify-between gap-3 items-center">
        {#if $installedEditors$.length > 0}<Tooltip
            content={m.modals_pullConflict_createWorkspace_tooltip()}
          >
            <span class="type-caption text-muted-foreground font-normal inline-block"
              >{m.modals_pullConflict_letIntentHandle_label()}</span
            >
          </Tooltip>{/if}
        <!-- Create workspace action -->
        <Button variant="primary" onclick={handleCreateWorkspace} class="ml-auto shrink-0 gap-2">
          <Fa icon={faCodeBranch} />
          {m.modals_pullConflict_createWorkspace_label()}
        </Button>
      </div>
    </div>
  {/snippet}
</ContentDialog>

<style>
  :global(body[data-pull-conflict-dialog-open] [data-slot='dialog-overlay']) {
    z-index: 10000 !important;
    -webkit-app-region: no-drag;
  }

  :global(body[data-pull-conflict-dialog-open] [data-slot='dialog-content']) {
    z-index: 10001 !important;
    -webkit-app-region: no-drag;
  }

  :global(body[data-pull-conflict-dialog-open] [data-slot='menu-content']) {
    z-index: 10002 !important;
  }
</style>
