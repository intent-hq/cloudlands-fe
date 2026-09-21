<script lang="ts">
  import { page } from '$app/state';
  import Terminal from '$lib/components/terminal/Terminal.svelte';

  let workspaceId = $derived(page.params.id || '');
  let terminalId = $derived(`terminal-${Date.now()}`);
</script>

<div class="terminal-test-page">
  <div class="header">
    <!-- i18n-ignore (dev-only terminal test page) -->
    <h1>Terminal Test</h1>
    <!-- i18n-ignore (dev-only terminal test page) -->
    <p>Testing the terminal implementation for workspace: {workspaceId}</p>
  </div>

  <div class="terminal-wrapper">
    <Terminal {workspaceId} {terminalId} />
  </div>
</div>

<style>
  .terminal-test-page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: hsl(var(--background));
  }

  .header {
    padding: 20px;
    background: hsl(var(--muted));
    border-bottom: 1px solid hsl(var(--border));
  }

  .header h1 {
    margin: 0;
    color: hsl(var(--foreground));
    font-size: 20px;
    font-weight: 500;
  }

  .header p {
    margin: 5px 0 0 0;
    color: hsl(var(--muted-foreground));
    font-size: 14px;
  }

  .terminal-wrapper {
    flex: 1;
    overflow: hidden;
  }
</style>
