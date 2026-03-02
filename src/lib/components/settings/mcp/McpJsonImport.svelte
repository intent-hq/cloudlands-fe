<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';

  interface Props {
    onImport: (json: string) => Promise<void>;
    onCancel: () => void;
  }

  let { onImport, onCancel }: Props = $props();

  let jsonContent = $state('');
  let error = $state('');
  let importing = $state(false);

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleImport();
    }
  }

  async function handleImport() {
    error = '';

    if (!jsonContent.trim()) {
      error = 'Please paste your MCP server JSON configuration';
      return;
    }

    // Validate JSON
    try {
      const parsed = JSON.parse(jsonContent);

      // Check for expected structure
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        error = 'Expected an object with server configurations (e.g., { "server-name": { ... } })';
        return;
      }

      // Check if there are any servers
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        error = 'No server configurations found in JSON';
        return;
      }

    } catch (e) {
      error = 'Invalid JSON format';
      return;
    }

    importing = true;
    try {
      await onImport(jsonContent);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Import failed';
    } finally {
      importing = false;
    }
  }
</script>

<div class="space-y-4">
  <div>
    <span class="block text-sm font-medium mb-1.5">Paste MCP Server JSON</span>
    <textarea
      bind:value={jsonContent}
      onkeydown={handleKeydown}
      placeholder={`{"my-server": {"command": "npx", "args": ["-y", "@some/mcp-server"]}}`}
      rows={12}
      class="w-full px-3 py-2 text-sm font-mono rounded-md border border-border
             bg-background focus:outline-none focus:ring-2 focus:ring-primary/30
             focus:border-primary resize-none"
    ></textarea>
    <p class="text-xs text-subtle mt-1">
      Supports MCP server JSON format from Claude Desktop, VS Code, etc.
    </p>
  </div>

  {#if error}
    <div class="text-sm text-destructive-foreground">{error}</div>
  {/if}

  <div class="flex gap-2">
    <Button variant="outline" onclick={onCancel} class="flex-1">Cancel</Button>
    <Button onclick={handleImport} disabled={importing} class="flex-1">
      {importing ? 'Importing...' : 'Import Servers'}
    </Button>
  </div>
</div>
