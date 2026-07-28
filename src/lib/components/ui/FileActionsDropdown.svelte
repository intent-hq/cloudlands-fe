<script lang="ts">
  import { createLogger } from '$lib/utils/client-logger';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import WorkspaceActionsMenu from '$lib/components/ui/WorkspaceActionsMenu.svelte';
  import Fa from 'svelte-fa';
  import { faArrowUpRightFromSquare, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import type { MenuAction } from '$lib/components/ui/WorkspaceActionsMenu.svelte';
  import { m } from '$shared/paraglide/messages.js';

  const logger = createLogger('FileActionsDropdown');

  interface Props {
    filePath?: string;
    workspaceId?: string;
    isDirectory?: boolean;
    variant?: 'default' | 'ghost' | 'outline';
    size?: 'xs' | 'sm' | 'lg';
    label?: string;
    isCompact?: boolean;
    workspaceFolderPath?: string;
    isDiff?: boolean;
    isWorkspaceRoot?: boolean;
    additionalActions?: MenuAction[];
    class?: string;
    /** Show delete file option for files */
    showDeleteFileOption?: boolean;
    /** Callback after file is deleted */
    onFileDeleted?: () => void;
  }

  let {
    filePath = '',
    workspaceId = '',
    isDirectory = false,
    variant = 'ghost',
    size = 'sm',
    label = m.ui_fileActions_open_label(),
    isCompact = false,
    workspaceFolderPath = '',
    isDiff = false,
    isWorkspaceRoot = false,
    additionalActions = [],
    class: className = '',
    showDeleteFileOption = false,
    onFileDeleted = undefined,
  }: Props = $props();

  let dropdownOpen = $state(false);

  // Check if filePath is valid
  let hasValidPath = $derived(
    filePath && typeof filePath === 'string' && filePath.trim().length > 0,
  );

  // Debug logging
  $effect(() => {
    if (filePath && typeof logger !== 'undefined') {
      logger.debug('[FileActionsDropdown] filePath:', { filePath, hasValidPath, workspaceId });
    }
  });

  function handleClose() {
    dropdownOpen = false;
  }

  // Button size classes
  const sizeClasses = {
    xs: 'px-2 !py-0.5 !pb-1.5 !h-auto text-xs',
    sm: 'px-3 py-1.5 text-xs',
    lg: 'px-6 py-3 text-base',
  };

  // Button variant classes
  const variantClasses = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    ghost: '',
    outline: 'border border-input bg-background hover:bg-accent/10 hover:text-accent',
  };

  // Map size to icon size for Button component
  const iconSizeMap = {
    xs: 'icon-xs',
    sm: 'icon-sm',
    lg: 'icon-lg',
  } as const;

  // Compute the button size based on compact mode
  let buttonSize = $derived(isCompact ? iconSizeMap[size] : size);
</script>

{#if hasValidPath}
  <DropdownMenu bind:open={dropdownOpen} align="end">
    {#snippet trigger({ toggle }: { toggle: () => void })}
      <Button
        variant="ghost-light"
        onclick={toggle}
        size={buttonSize}
        class="
          {sizeClasses[size]} {variantClasses[variant]} {className}"
        title={isCompact ? label : undefined}
      >
        {#if isCompact}
          <Fa icon={faArrowUpRightFromSquare} class="h-2.5! w-2.5! text-ghost" />
        {:else}
          <span>{label}</span>
          <Fa icon={faChevronDown} class="h-2 w-2" />
        {/if}
      </Button>
    {/snippet}

    {#snippet content()}
      <div class="w-48">
        <WorkspaceActionsMenu
          {filePath}
          {workspaceId}
          {isDirectory}
          {workspaceFolderPath}
          {isDiff}
          {isWorkspaceRoot}
          {additionalActions}
          onClose={handleClose}
          showDeleteOption={false}
          showFileNameCopy={true}
          {showDeleteFileOption}
          {onFileDeleted}
        />
      </div>
    {/snippet}
  </DropdownMenu>
{:else}
  <!-- Show a disabled Button with tooltip when no path is available -->
  <div class="relative inline-flex flex-col" title={m.ui_fileActions_noRepoPath_tooltip()}>
    <Button
      variant="ghost"
      size={buttonSize}
      disabled
      class="inline-flex items-center justify-center rounded-md font-medium transition-colors
           text-subtle
           focus-visible:outline-none
           disabled:pointer-events-none disabled:opacity-50 cursor-not-allowed
           {sizeClasses[size]} {variantClasses[variant]} {className}"
      title={isCompact ? label : undefined}
    >
      {#if isCompact}
        <Fa icon={faArrowUpRightFromSquare} class="h-2.5 w-2.5 text-ghost" />
      {:else}
        <span>{label}</span>
        <Fa icon={faChevronDown} class="ml-2 h-3 w-3" />
      {/if}
    </Button>
  </div>
{/if}
