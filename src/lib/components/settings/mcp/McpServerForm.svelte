<script lang="ts">
  import type { McpServerFormState, McpTransportType, McpAuthType } from './types';
  import { createEmptyFormState, formStateToServer } from './types';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    /** Initial form values (for edit mode) */
    initialValues?: McpServerFormState;
    /** Whether this is for editing an existing server */
    editMode?: boolean;
    /** Called when form is submitted */
    onSubmit: (config: ReturnType<typeof formStateToServer>) => void;
    /** Called when form is cancelled */
    onCancel: () => void;
  }

  let { initialValues, editMode = false, onSubmit, onCancel }: Props = $props();

  // Form state - initialize once from props
  function getInitialForm(): McpServerFormState {
    return initialValues ? { ...initialValues } : createEmptyFormState();
  }

  let form = $state<McpServerFormState>(getInitialForm());
  let error = $state('');

  // Transport type options
  const transportTypes: { value: McpTransportType; label: string }[] = [
    { value: 'stdio', label: 'Local (stdio)' },
    { value: 'http', label: 'HTTP' },
    { value: 'sse', label: 'SSE (Server-Sent Events)' },
  ];

  // Auth type options
  const authTypes: { value: McpAuthType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'oauth', label: 'OAuth' },
    { value: 'header', label: 'Header Auth' },
  ];

  // Add a new env var pair
  function addEnvVar() {
    form.envPairs = [...form.envPairs, { id: crypto.randomUUID(), key: '', value: '' }];
  }

  // Remove an env var pair
  function removeEnvVar(id: string) {
    form.envPairs = form.envPairs.filter((p) => p.id !== id);
  }

  // Add a new header pair
  function addHeader() {
    form.headerPairs = [...form.headerPairs, { id: crypto.randomUUID(), key: '', value: '' }];
  }

  // Remove a header pair
  function removeHeader(id: string) {
    form.headerPairs = form.headerPairs.filter((p) => p.id !== id);
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleSubmit();
    }
  }

  // Validate and submit
  function handleSubmit() {
    error = '';

    // Validate name
    if (!form.name.trim()) {
      error = 'Server name is required';
      return;
    }

    // Validate based on type
    if (form.type === 'stdio') {
      if (!form.command.trim()) {
        error = 'Command is required';
        return;
      }
    } else {
      if (!form.url.trim()) {
        error = 'URL is required';
        return;
      }
      // Basic URL validation
      try {
        new URL(form.url);
      } catch {
        error = 'Invalid URL format';
        return;
      }
    }

    const config = formStateToServer(form);
    onSubmit(config);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="space-y-4" onkeydown={handleKeydown}>
  <!-- Server Name -->
  <div>
    <span class="block text-sm font-medium mb-1.5">
      Server Name <span class="text-destructive-foreground">*</span>
    </span>
    <Input
      bind:value={form.name}
      placeholder="e.g., my-mcp-server"
      disabled={editMode}
    />
    <p class="text-xs text-subtle mt-1">A unique identifier for this MCP server</p>
  </div>

  <!-- Connection Type -->
  <div>
    <span class="block text-sm font-medium mb-1.5">
      Connection Type <span class="text-destructive-foreground">*</span>
    </span>
    <div class="flex gap-1 p-1 bg-muted rounded-lg w-fit">
      {#each transportTypes as type (type.value)}
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer
                 {form.type === type.value
                   ? 'bg-background text-foreground shadow-sm'
                   : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (form.type = type.value)}
        >
          {type.label}
        </button>
      {/each}
    </div>
    <p class="text-xs text-subtle mt-1.5">
      {#if form.type === 'stdio'}
        Local servers run as a command on your machine
      {:else if form.type === 'http'}
        HTTP servers communicate via standard HTTP requests
      {:else}
        SSE servers use Server-Sent Events for real-time streaming
      {/if}
    </p>
  </div>

  <!-- stdio fields -->
  {#if form.type === 'stdio'}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <span class="block text-sm font-medium mb-1.5">
          Command <span class="text-destructive-foreground">*</span>
        </span>
        <Input bind:value={form.command} placeholder="npx -y @some/mcp-server" />
        <p class="text-xs text-subtle mt-1">e.g., npx, node, python</p>
      </div>

      <div>
        <span class="block text-sm font-medium mb-1.5">Arguments</span>
        <Input bind:value={form.args} placeholder="--port 3000 --verbose" />
        <p class="text-xs text-subtle mt-1">Space-separated</p>
      </div>
    </div>

    <!-- Environment Variables -->
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-sm font-medium">Environment Variables</span>
        <Button size="sm" variant="ghost" onclick={addEnvVar}>
          <Fa icon={faPlus} class="mr-1" size="xs" />
          Add
        </Button>
      </div>
      <p class="text-xs text-subtle mb-2">Pass secrets or configuration to the server process</p>
      {#if form.envPairs.length === 0}
        <p class="text-xs text-subtle italic">No environment variables set</p>
      {:else}
        <div class="space-y-2">
          {#each form.envPairs as pair (pair.id)}
            <div class="flex gap-2 items-center">
              <Input bind:value={pair.key} placeholder="KEY" class="flex-1" />
              <span class="text-subtle">=</span>
              <Input bind:value={pair.value} placeholder="value" class="flex-1" />
              <Button size="sm" variant="ghost" onclick={() => removeEnvVar(pair.id)}>
                <Fa icon={faTrash} size="xs" class="text-destructive-foreground" />
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Remote fields (http/sse) -->
    <div>
      <span class="block text-sm font-medium mb-1.5">
        URL <span class="text-destructive-foreground">*</span>
      </span>
      <Input bind:value={form.url} placeholder="https://example.com/mcp" />
      <p class="text-xs text-subtle mt-1">The full URL of the MCP server endpoint</p>
    </div>

    <!-- Auth Type -->
    <div>
      <span class="block text-sm font-medium mb-1.5">Authentication</span>
      <div class="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {#each authTypes as auth (auth.value)}
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer
                   {form.authType === auth.value
                     ? 'bg-background text-foreground shadow-sm'
                     : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (form.authType = auth.value)}
          >
            {auth.label}
          </button>
        {/each}
      </div>
      <p class="text-xs text-subtle mt-1.5">
        {#if form.authType === 'none'}
          No authentication required for this server
        {:else if form.authType === 'oauth'}
          Authenticate via OAuth flow when connecting
        {:else}
          Send custom headers with each request (e.g., API keys)
        {/if}
      </p>
    </div>

    <!-- Headers (for header auth) -->
    {#if form.authType === 'header'}
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-medium">Authorization Headers</span>
          <Button size="sm" variant="ghost" onclick={addHeader}>
            <Fa icon={faPlus} class="mr-1" size="xs" />
            Add
          </Button>
        </div>
        <p class="text-xs text-subtle mb-2">Add headers like Authorization, X-API-Key, etc.</p>
        {#if form.headerPairs.length === 0}
          <p class="text-xs text-subtle italic">No headers set</p>
        {:else}
          <div class="space-y-2">
            {#each form.headerPairs as pair (pair.id)}
              <div class="flex gap-2 items-center">
                <Input bind:value={pair.key} placeholder="Header-Name" class="flex-1" />
                <span class="text-subtle">:</span>
                <Input bind:value={pair.value} placeholder="value" class="flex-1" />
                <Button size="sm" variant="ghost" onclick={() => removeHeader(pair.id)}>
                  <Fa icon={faTrash} size="xs" class="text-destructive-foreground" />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if form.authType === 'oauth'}
      <div class="p-3 bg-muted/30 rounded-md border border-border">
        <p class="text-sm text-subtle">
          You'll be prompted to authenticate via OAuth when you first connect to this server. The server will handle the authentication flow.
        </p>
      </div>
    {/if}
  {/if}

  <!-- Error message -->
  {#if error}
    <div class="text-sm text-destructive-foreground">{error}</div>
  {/if}

  <!-- Actions -->
  <div class="flex gap-2 pt-2">
    <Button variant="outline" onclick={onCancel} class="flex-1">Cancel</Button>
    <Button onclick={handleSubmit} class="flex-1">
      {editMode ? 'Update Server' : 'Add Server'}
    </Button>
  </div>
</div>
