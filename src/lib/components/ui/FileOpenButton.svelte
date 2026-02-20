<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Fa from 'svelte-fa';
  import { faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    filePath?: string;
    workspaceFolderPath?: string;
    isDirectory?: boolean;
    size?: 'xs' | 'sm' | 'lg';
    class?: string;
  }

  let {
    filePath = '',
    workspaceFolderPath = '',
    isDirectory = false,
    size = 'sm',
    class: className = '',
  }: Props = $props();

  // Check if filePath is valid
  let hasValidPath = $derived(
    filePath && typeof filePath === 'string' && filePath.trim().length > 0,
  );

  // Map size to icon size for Button component
  const iconSizeMap = {
    xs: 'icon-xs',
    sm: 'icon-sm',
    lg: 'icon-lg',
  } as const;

  async function handleOpen() {
    if (!hasValidPath || !window.electronAPI) return;

    // Resolve path if needed
    let resolvedPath = filePath;
    if (workspaceFolderPath && !filePath.startsWith('/')) {
      resolvedPath = `${workspaceFolderPath}/${filePath}`;
    }

    // Open in VS Code (default action for files/directories)
    // Use vscode:open with folder context if available, otherwise just the file path
    if (workspaceFolderPath) {
      await window.electronAPI.invoke('vscode:open', {
        folder: workspaceFolderPath,
        file: resolvedPath,
      });
    } else {
      await window.electronAPI.invoke('vscode:open', resolvedPath);
    }
  }
</script>

{#if hasValidPath}
  <Button
    variant="ghost-light"
    onclick={handleOpen}
    size={iconSizeMap[size]}
    class={className}
    title={isDirectory ? 'Open folder in VS Code' : 'Open file in VS Code'}
  >
    <Fa icon={faArrowUpRightFromSquare} />
  </Button>
{/if}
