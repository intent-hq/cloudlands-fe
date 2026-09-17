<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import {
    resolveEditorFallbackIcon,
    resolveEditorIcon,
    type EditorIconComponent,
  } from '$lib/components/shared/icons/editor-icon';
  import { Button } from '$lib/components/ui/button';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import * as Menu from '$lib/components/ui/menu';
  import { notify } from '$lib/components/patterns/notify';
  import { invoke } from '$lib/electron-bridge';
  import {
    fetchEditors,
    setOpenAction,
    type InstalledEditor,
    type OpenAction,
  } from '$store/renderer/slices/external-editors/external-editors-slice';
  import {
    selectHiddenEditorIds,
    selectInstalledEditorsFiltered,
    selectOpenAction,
  } from '$store/renderer/slices/external-editors/external-editors-selectors';
  import { selectIsWorkspaceHostLocal } from '$store/renderer/slices/workspace/workspace-selectors';
  import { writable } from 'svelte/store';

  import { createLogger } from '$lib/utils/client-logger';
  import { m } from '$shared/paraglide/messages.js';
  import { hasCapability } from '$lib/utils/platform-capabilities';
  import { toNativePath } from '$lib/utils/path-utils';
  import {
    faArrowUpRightFromSquare,
    faChevronDown,
    faCodeBranch,
    faCopy,
    faFolderOpen,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { store as appStore } from '$store/renderer/store';
  import { getVisibleOpenInEditors } from './open-combo-actions';

  const logger = createLogger('OpenComboButton');
  interface ActionConfig {
    id: OpenAction;
    label: string;
    shortLabel: string;
    icon: EditorIconComponent | null;
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
    /** Workspace whose files `filePath` belongs to; tightens the locality gate to workspace locality (monorepo#2171) */
    workspaceId?: string;
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
    /** Render as a labeled submenu inside an existing action menu. */
    embedded?: boolean;
    /** Render a children trigger as inline sentence text. */
    inline?: boolean;
    /** Render an icon-only children trigger as a fixed icon-sized transparent control. */
    iconOnly?: boolean;
    children?: Snippet;
  }

  let {
    filePath,
    workspaceId = '',
    isDirectory = true,
    workspaceFolderPath,
    class: className = '',
    headerText,
    usePortal = true,
    side = 'bottom',
    variant = 'default',
    branchName,
    compact = false,
    embedded = false,
    inline = false,
    iconOnly = false,
    children = undefined,
  }: Props = $props();

  const bgClass = $derived(
    variant === 'sidebar' ? 'bg-sidebar hover:bg-sidebar/80' : 'bg-background hover:bg-muted',
  );

  // Mirror the workspaceId prop into a store so the selectors below re-run
  // when it changes.
  // svelte-ignore state_referenced_locally - intentional initial capture; the $effect below syncs later changes
  const workspaceIdStore = writable(workspaceId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });

  const openAction = selectOpenAction();
  const installedEditors$ = selectInstalledEditorsFiltered(workspaceIdStore);
  const hiddenEditorIds$ = selectHiddenEditorIds();
  // With an empty workspaceId this reduces to daemon locality (a missing
  // workspace entity is treated as local), so it is the single gate for both
  // the daemon-remote (monorepo#883) and workspace-remote (monorepo#2171)
  // cases.
  const isWorkspaceHostLocal$ = selectIsWorkspaceHostLocal(workspaceIdStore);

  let dropdownOpen = $state(false);

  // Fetch installed editors when component mounts
  onMount(() => {
    appStore.dispatch(fetchEditors());
  });

  /** Convert installed editor to action config */
  function editorToAction(editor: InstalledEditor): ActionConfig {
    return {
      id: editor.id,
      label: editor.name,
      shortLabel: editor.shortLabel,
      icon: resolveEditorIcon(editor),
      shortcut: editor.shortcut,
      handlerType: editor.handlerType,
      appName: editor.appName,
      category: editor.category,
      iconBase64: editor.iconBase64,
    };
  }

  // Whether external editors can be opened at all (Electron-only capability).
  // On web, only the copy actions are offered.
  const canOpenExternalEditors = hasCapability('externalEditors');

  // Build actions from installed editors dynamically
  let actions: ActionConfig[] = $derived.by(() => {
    const installedEditors = $installedEditors$;

    // Convert installed editors to action configs, sorted by priority
    const editorActions: ActionConfig[] = getVisibleOpenInEditors(
      installedEditors,
      $hiddenEditorIds$,
    ).map(editorToAction);

    // Add "Other..." option to pick any app
    const otherAction: ActionConfig = {
      id: 'other' as OpenAction,
      label: m.ui_openCombo_other_label(),
      shortLabel: m.ui_openCombo_other_label(),
      icon: null,
      faIcon: faFolderOpen,
      handlerType: 'generic',
    };

    // Add special actions (copy, copy-branch)
    const specialActions: ActionConfig[] = [
      {
        id: 'copy',
        label: m.ui_openCombo_copyPath_label(),
        shortLabel: m.ui_openCombo_copy_shortLabel(),
        icon: null,
        faIcon: faCopy,
        // shortcut: '⌘⇧C',
      },
      ...(branchName
        ? [
            {
              id: 'copy-branch' as const,
              label: m.ui_openCombo_copyBranch_label(),
              shortLabel: m.ui_openCombo_copyBranch_shortLabel(),
              icon: null,
              faIcon: faCodeBranch,
            },
          ]
        : []),
    ];

    if (!canOpenExternalEditors) {
      return specialActions;
    }

    // "Other…" shows a LOCAL app picker and spawns a local app against a
    // workspace file path, so it is meaningless on a remote daemon
    // (monorepo#883) or a remote workspace (monorepo#2171). Same locality
    // gate as selectInstalledEditorsFiltered; omitting it also makes the
    // `actions[0]` primary-action fallback land on "Copy path".
    if (!$isWorkspaceHostLocal$) {
      return specialActions;
    }

    return [...editorActions, otherAction, ...specialActions];
  });

  // "Open-capable" means anything beyond the always-present copy specials
  // (editor/terminal/finder/"Other…"). When none remain — remote daemon or web
  // build — the "Open in …" combo presentation is dropped (monorepo#890).
  const hasOpenCapableAction = $derived(
    actions.some((a) => a.id !== 'copy' && a.id !== 'copy-branch'),
  );

  const currentAction = $derived.by(() => {
    if (!hasOpenCapableAction) {
      // Primary is always "Copy path" here, even if a now-gated editor (or
      // "Copy branch name") is the remembered open action.
      return actions.find((a) => a.id === 'copy') || actions[0];
    }
    return actions.find((a) => a.id === $openAction) || actions[0];
  });

  const primaryTitle = $derived(
    hasOpenCapableAction
      ? m.ui_openCombo_openIn_tooltip({ name: currentAction.label })
      : currentAction.label,
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
        notify.success(m.ui_openCombo_pathCopied_label());
        return;
      }
      if (actionId === 'copy-branch') {
        if (branchName) {
          await navigator.clipboard.writeText(branchName);
          notify.success(m.ui_openCombo_branchCopied_label());
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
          // i18n-ignore (IPC sentinel string from the main process, not UI copy)
        } else if (result?.error && result.error !== 'No application selected') {
          // Surface bridge-absent / spawn failures as a toast so the "Other"
          // action fails loudly instead of silently no-oping.
          notify.error(result.error);
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
      notify.error(
        error instanceof Error
          ? error.message
          : m.ui_openCombo_openFailed_error({ name: actionId }),
      );
    }
  }

  function handlePrimaryClick(event: MouseEvent) {
    event.stopPropagation();
    executeAction(currentAction.id);
  }

  function handleInlineKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    executeAction(currentAction.id);
  }

  function keepPrimaryActionOutsideDropdown(event: Event) {
    event.stopPropagation();
  }

  function handleActionClick(actionId: OpenAction) {
    appStore.dispatch(setOpenAction(actionId));
    executeAction(actionId);
    dropdownOpen = false;
  }

  // Remove global keyboard shortcuts - these are now handled by the sidebar
  // to prevent duplicate toasts when multiple OpenComboButton instances exist
</script>

{#if embedded}
  <Menu.Sub>
    <Menu.SubTrigger>
      <Fa icon={faArrowUpRightFromSquare} size="xs" class="w-4 text-muted-foreground opacity-70" />
      <span>{m.ui_openCombo_openInApp_tooltip()}</span>
    </Menu.SubTrigger>
    <Menu.SubContent class="w-60">
      {#each actions as action (action.id)}
        <Menu.Item onclick={() => handleActionClick(action.id)}>
          {#if action.iconBase64}
            <img src="data:image/png;base64,{action.iconBase64}" alt="" class="size-4" />
          {:else if action.icon}
            {@const Icon = action.icon}
            <Icon size={16} />
          {:else if action.faIcon}
            <Fa icon={action.faIcon} class="size-4 text-muted-foreground opacity-70" />
          {:else}
            <Fa
              icon={resolveEditorFallbackIcon(action.category)}
              class="size-4 text-muted-foreground opacity-70"
            />
          {/if}
          <span class="min-w-0 flex-1 truncate">{action.label}</span>
          {#if action.shortcut}
            <kbd class="type-caption ml-4 text-muted-foreground" aria-hidden="true">
              {action.shortcut}
            </kbd>
          {/if}
        </Menu.Item>
      {/each}
    </Menu.SubContent>
  </Menu.Sub>
{:else}
  <div class="{inline && children ? 'contents' : 'inline-flex items-center'} {className}">
    <DropdownMenu
      bind:open={dropdownOpen}
      align="end"
      portal={usePortal}
      {side}
      class={inline && children ? 'contents!' : ''}
    >
      {#snippet trigger({ props })}
        {#if inline && children}
          <!-- A native button is an atomic inline box, which strands punctuation
               after a wrapped path. This semantic button stays in the text flow. -->
          <span
            role="button"
            tabindex="0"
            onclick={actions.length > 1 ? undefined : handlePrimaryClick}
            onkeydown={actions.length > 1 ? undefined : handleInlineKeyDown}
            {...actions.length > 1 ? props : {}}
            class="cursor-pointer break-words rounded-sm text-inherit underline decoration-muted-foreground/20 underline-offset-2 hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={primaryTitle}>{@render children()}</span
          >
        {:else if children}
          <!-- With a single action there is no dropdown to show; run it directly. -->
          <Button
            type="button"
            onclick={actions.length > 1 ? undefined : handlePrimaryClick}
            {...actions.length > 1 ? props : {}}
            variant={iconOnly ? 'plain' : 'ghost'}
            size={iconOnly ? 'icon-sm' : undefined}
            wrapContent={!iconOnly}
            class={iconOnly
              ? 'cursor-pointer text-muted-foreground hover:text-foreground focus-visible:text-foreground'
              : 'cursor-pointer'}
            title={primaryTitle}
          >
            {@render children()}
          </Button>
        {:else if compact}
          <!-- Compact mode: single icon button with dropdown -->
          <Button
            {...props}
            variant="ghost-light"
            size="icon-xs"
            tooltip={m.ui_openCombo_openInApp_tooltip()}
            tooltipSide="bottom"
          >
            <Fa icon={faArrowUpRightFromSquare} size="xs" />
          </Button>
        {:else}
          <!-- Full mode: icon + "Open" text + dropdown chevron -->
          <div
            class="inline-flex items-stretch rounded-md border border-border"
            data-open-combo-control
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="gap-1.5 px-2 {actions.length > 1 ? 'rounded-r-none' : ''} {bgClass}"
              onpointerdown={keepPrimaryActionOutsideDropdown}
              onkeydown={keepPrimaryActionOutsideDropdown}
              onclick={handlePrimaryClick}
              title={primaryTitle}
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
              {:else}
                <Fa
                  icon={resolveEditorFallbackIcon(currentAction.category)}
                  class="w-3.5 h-3.5 opacity-60"
                />
              {/if}
              <span class="text-muted-foreground"
                >{hasOpenCapableAction ? m.ui_openCombo_open_label() : currentAction.label}</span
              >
            </Button>
            {#if actions.length > 1}
              <Button
                {...props}
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={m.ui_openCombo_openInApp_tooltip()}
                class="rounded-l-none border-l border-border {bgClass}"
              >
                <Fa icon={faChevronDown} class="size-3! text-muted-foreground" />
              </Button>
            {/if}
          </div>
        {/if}
      {/snippet}

      {#snippet content()}
        <div class="w-60 max-w-full">
          {#if headerText}
            <div class="type-caption px-2 py-1.5 text-subtle">
              {headerText}
            </div>
          {/if}
          {#each actions as action (action.id)}
            <Menu.Item onSelect={() => handleActionClick(action.id)} textValue={action.label}>
              {#snippet leading()}
                {#if action.iconBase64}
                  <img src="data:image/png;base64,{action.iconBase64}" alt="" class="size-4" />
                {:else if action.icon}
                  {@const Icon = action.icon}
                  <Icon size={16} />
                {:else if action.faIcon}
                  <Fa icon={action.faIcon} class="size-4 text-muted-foreground" />
                {:else}
                  <Fa
                    icon={resolveEditorFallbackIcon(action.category)}
                    class="size-4 text-muted-foreground"
                  />
                {/if}
              {/snippet}
              <span class="min-w-0 flex-1">
                <span class="block truncate">{action.label}</span>
                {#if action.description}
                  <span class="type-caption block truncate text-subtle" title={action.description}>
                    {action.description}
                  </span>
                {/if}
              </span>
              {#if action.shortcut}
                <kbd class="type-caption ml-4 shrink-0 text-muted-foreground" aria-hidden="true">
                  {action.shortcut}
                </kbd>
              {/if}
            </Menu.Item>
          {/each}
        </div>
      {/snippet}
    </DropdownMenu>
  </div>
{/if}
