<script lang="ts">
  import { invoke } from '$lib/electron-bridge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import Fa from 'svelte-fa';
  import {
    faFolder,
    faFile,
    faChevronRight,
    faHome,
    faArrowLeft,
    faSpinner,
  } from '@fortawesome/free-solid-svg-icons';
  interface Props {
    sshConfig: {
      host: string;
      port: number;
      user: string;
      password?: string;
      keyPath?: string;
    };
    initialPath?: string;
    onSelect?: (path: string) => void;
    onCancel?: () => void;
  }

  let { sshConfig, initialPath = '/home', onSelect, onCancel }: Props = $props();

  let currentPath = $state(initialPath);
  let items = $state<Array<{ name: string; type: 'file' | 'directory'; path: string }>>([]);
  let loading = $state(false);
  let error: string | null = $state(null);
  let selectedPath: string | null = $state(null);

  // Load directory contents
  async function loadDirectory(path: string) {
    loading = true;
    error = null;

    try {
      const response: any = await invoke('ssh:listDirectory', {
        config: {
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.user,
          password: sshConfig.password,
          privateKeyPath: sshConfig.keyPath,
        },
        path: path,
      });

      if (response.success) {
        items = response.data.items || [];
        currentPath = path;
      } else {
        error = response.error || 'Failed to load directory';
      }
    } catch (err: any) {
      error = err.message || 'Failed to load directory';
    } finally {
      loading = false;
    }
  }

  // Navigate to directory
  function navigateTo(path: string) {
    loadDirectory(path);
  }

  // Go to parent directory
  function goUp() {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  }

  // Go to home directory
  function goHome() {
    navigateTo('/home');
  }

  // Select directory
  function selectDirectory(path: string) {
    selectedPath = path;
  }

  // Confirm selection
  function confirmSelection() {
    if (selectedPath) {
      onSelect?.(selectedPath);
    }
  }

  // Load initial directory
  $effect(() => {
    if (sshConfig.host) {
      loadDirectory(currentPath);
    }
  });
</script>

<div class="flex flex-col h-[500px] border border-border rounded-lg overflow-hidden">
  <!-- Header -->
  <div class="flex items-center gap-2 p-3 border-b border-border bg-muted/50">
    <Button size="icon-sm" variant="ghost" onclick={goUp} disabled={currentPath === '/'}>
      <Fa icon={faArrowLeft} size="sm" />
    </Button>
    <Button size="icon-sm" variant="ghost" onclick={goHome}>
      <Fa icon={faHome} size="sm" />
    </Button>
    <div class="flex-1 flex items-center gap-2">
      <Input
        value={currentPath}
        onchange={(e: any) => navigateTo(e.target.value)}
        class="text-sm"
        placeholder="/path/to/directory"
      />
    </div>
  </div>

  <!-- Directory Contents -->
  <div class="flex-1 overflow-y-auto p-2">
    {#if loading}
      <div class="flex items-center justify-center h-full">
        <Fa icon={faSpinner} size="2x" class="animate-spin text-muted-foreground" />
      </div>
    {:else if error}
      <div class="flex flex-col items-center justify-center h-full gap-2">
        <p class="text-sm text-destructive">{error}</p>
        <Button size="sm" variant="outline" onclick={() => loadDirectory(currentPath)}>
          Retry
        </Button>
      </div>
    {:else if items.length === 0}
      <div class="flex items-center justify-center h-full">
        <p class="text-sm text-muted-foreground">Empty directory</p>
      </div>
    {:else}
      <div class="space-y-1">
        {#each items as item (item.path)}
          <button
            class="w-full flex items-center gap-2 p-2 rounded hover:bg-accent transition-colors text-left {selectedPath ===
            item.path
              ? 'bg-accent'
              : ''}"
            onclick={() => {
              if (item.type === 'directory') {
                navigateTo(item.path);
              }
            }}
            ondblclick={() => {
              if (item.type === 'directory') {
                selectDirectory(item.path);
                confirmSelection();
              }
            }}
          >
            {#if item.type === 'directory'}
              <Fa icon={faFolder} size="sm" class="text-blue-500" />
            {:else}
              <Fa icon={faFile} size="sm" class="text-muted-foreground" />
            {/if}
            <span class="flex-1 text-sm truncate">{item.name}</span>
            {#if item.type === 'directory'}
              <Fa icon={faChevronRight} size="sm" class="text-muted-foreground" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex items-center justify-between p-3 border-t border-border bg-muted/50">
    <div class="text-sm text-muted-foreground">
      {#if selectedPath}
        Selected: <span class="font-mono">{selectedPath}</span>
      {:else}
        Select a directory
      {/if}
    </div>
    <div class="flex gap-2">
      <Button size="sm" variant="outline" onclick={() => onCancel?.()}>Cancel</Button>
      <Button
        size="sm"
        onclick={() => {
          selectDirectory(currentPath);
          confirmSelection();
        }}
      >
        Select Current Directory
      </Button>
    </div>
  </div>
</div>
