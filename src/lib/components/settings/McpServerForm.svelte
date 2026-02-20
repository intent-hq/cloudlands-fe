<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { Select } from '$lib/components/ui/select';
  import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { logger } from '../../../shared/logger';

  interface Props {
    onSubmit: (server: McpServerConfig) => Promise<void>;
    onCancel: () => void;
  }

  interface McpServerConfig {
    name: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string;
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
  }

  let { onSubmit, onCancel }: Props = $props();

  // Form state
  let name = $state('');
  let transport = $state<'stdio' | 'http' | 'sse'>('stdio');
  let command = $state('');
  let args = $state('');
  let url = $state('');
  let isSubmitting = $state(false);
  let error = $state('');

  // Key-value pairs for env and headers
  let envPairs = $state<{ key: string; value: string }[]>([]);
  let headerPairs = $state<{ key: string; value: string }[]>([]);

  function addEnvPair() {
    envPairs = [...envPairs, { key: '', value: '' }];
  }

  function removeEnvPair(index: number) {
    envPairs = envPairs.filter((_, i) => i !== index);
  }

  function addHeaderPair() {
    headerPairs = [...headerPairs, { key: '', value: '' }];
  }

  function removeHeaderPair(index: number) {
    headerPairs = headerPairs.filter((_, i) => i !== index);
  }

  async function handleSubmit() {
    error = '';

    // Validate
    if (!name.trim()) {
      error = 'Server name is required';
      return;
    }

    if (transport === 'stdio' && !command.trim()) {
      error = 'Command is required for stdio transport';
      return;
    }

    if ((transport === 'http' || transport === 'sse') && !url.trim()) {
      error = 'URL is required for HTTP/SSE transport';
      return;
    }

    // Build config
    const config: McpServerConfig = {
      name: name.trim(),
      transport,
    };

    if (transport === 'stdio') {
      config.command = command.trim();
      if (args.trim()) config.args = args.trim();
      const envObj: Record<string, string> = {};
      envPairs.forEach((p) => {
        if (p.key.trim()) envObj[p.key.trim()] = p.value;
      });
      if (Object.keys(envObj).length > 0) config.env = envObj;
    } else {
      config.url = url.trim();
      const headersObj: Record<string, string> = {};
      headerPairs.forEach((p) => {
        if (p.key.trim()) headersObj[p.key.trim()] = p.value;
      });
      if (Object.keys(headersObj).length > 0) config.headers = headersObj;
    }

    isSubmitting = true;
    try {
      await onSubmit(config);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      logger.error('Failed to add MCP server:', e);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="space-y-4">
  <div class="grid grid-cols-2 gap-4">
    <!-- Server Name -->
    <div>
      <label class="block text-xs font-medium text-muted-foreground mb-1">Server Name</label>
      <Input bind:value={name} placeholder="my-server" class="h-8 text-sm" />
    </div>

    <!-- Transport Type -->
    <div>
      <label class="block text-xs font-medium text-muted-foreground mb-1">Transport</label>
      <Select.Root bind:value={transport}>
        <Select.Trigger class="h-8 text-sm">
          <Select.Value placeholder="Select transport" />
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="stdio">Stdio (Local Command)</Select.Item>
          <Select.Item value="http">HTTP</Select.Item>
          <Select.Item value="sse">SSE (Server-Sent Events)</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  </div>

  {#if transport === 'stdio'}
    <!-- Stdio fields -->
    <div>
      <label class="block text-xs font-medium text-muted-foreground mb-1">Command</label>
      <Input bind:value={command} placeholder="npx" class="h-8 text-sm" />
    </div>
    <div>
      <label class="block text-xs font-medium text-muted-foreground mb-1">Arguments</label>
      <Input bind:value={args} placeholder="-y @upstash/context7-mcp@latest" class="h-8 text-sm" />
    </div>

    <!-- Environment Variables -->
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs font-medium text-muted-foreground">Environment Variables</label>
        <button type="button" onclick={addEnvPair} class="text-xs text-primary hover:underline">
          <Fa icon={faPlus} class="inline mr-1" />Add
        </button>
      </div>
      {#each envPairs as pair, i}
        <div class="flex gap-2 mb-2">
          <Input bind:value={pair.key} placeholder="KEY" class="h-7 text-xs flex-1" />
          <Input bind:value={pair.value} placeholder="value" class="h-7 text-xs flex-1" />
          <button type="button" onclick={() => removeEnvPair(i)} class="text-destructive p-1">
            <Fa icon={faTrash} size="xs" />
          </button>
        </div>
      {/each}
    </div>
  {:else}
    <!-- HTTP/SSE fields -->
    <div>
      <label class="block text-xs font-medium text-muted-foreground mb-1">URL</label>
      <Input bind:value={url} placeholder="https://mcp.example.com/v1" class="h-8 text-sm" />
    </div>

    <!-- Headers -->
    <div>
      <div class="flex items-center justify-between mb-1">
        <label class="text-xs font-medium text-muted-foreground">Headers</label>
        <button type="button" onclick={addHeaderPair} class="text-xs text-primary hover:underline">
          <Fa icon={faPlus} class="inline mr-1" />Add
        </button>
      </div>
      {#each headerPairs as pair, i}
        <div class="flex gap-2 mb-2">
          <Input bind:value={pair.key} placeholder="Authorization" class="h-7 text-xs flex-1" />
          <Input bind:value={pair.value} placeholder="Bearer ..." class="h-7 text-xs flex-1" />
          <button type="button" onclick={() => removeHeaderPair(i)} class="text-destructive p-1">
            <Fa icon={faTrash} size="xs" />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  {#if error}
    <p class="text-xs text-destructive">{error}</p>
  {/if}

  <div class="flex justify-end gap-2 pt-2">
    <Button variant="outline" size="sm" onclick={onCancel} disabled={isSubmitting}>Cancel</Button>
    <Button size="sm" onclick={handleSubmit} disabled={isSubmitting}>
      {isSubmitting ? 'Adding...' : 'Add Server'}
    </Button>
  </div>
</div>
