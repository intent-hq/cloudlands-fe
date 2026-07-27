<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import { m } from '$shared/paraglide/messages.js';

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
      error = m.settings_mcp_import_emptyError();
      return;
    }

    // Validate JSON
    try {
      const parsed = JSON.parse(jsonContent);

      // Check for expected structure
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        error = m.settings_mcp_import_structureError();
        return;
      }

      // Check if there are any servers
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        error = m.settings_mcp_import_noServersError();
        return;
      }

    } catch {
      error = m.settings_mcp_import_invalidJsonError();
      return;
    }

    importing = true;
    try {
      await onImport(jsonContent);
    } catch (e) {
      error = e instanceof Error ? e.message : m.settings_mcp_import_failedError();
    } finally {
      importing = false;
    }
  }
</script>

<div class="space-y-4">
  <div>
    <span class="block text-sm font-medium mb-1.5">{m.settings_mcp_import_title()}</span>
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
      {m.settings_mcp_import_formatHint()}
    </p>
  </div>

  {#if error}
    <div class="text-sm text-destructive-foreground">{error}</div>
  {/if}

  <div class="flex gap-2">
    <Button variant="outline" onclick={onCancel} class="flex-1">{m.settings_mcp_import_cancel()}</Button>
    <Button onclick={handleImport} disabled={importing} class="flex-1">
      {importing ? m.settings_mcp_import_importing() : m.settings_mcp_import_importServers()}
    </Button>
  </div>
</div>
