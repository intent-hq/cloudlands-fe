<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SettingsPageShell from './settings-page-shell.svelte';

  let backCount = $state(0);
</script>

<SettingsPageShell
  title="Application settings"
  description="Configure the application without changing workspace state."
  backLabel="Back to workspace"
  backShortcut="⌘,"
  backShortcutLabel="Command comma"
  onBack={() => (backCount += 1)}
  busy
>
  {#snippet navigation()}
    <nav class="flex w-max gap-4" aria-label="Settings sections">
      <a href="#general">General</a>
      <a href="#appearance">Appearance and colors</a>
      <a href="#accounts">Accounts and providers</a>
    </nav>
  {/snippet}
  <div class="min-h-96"><Button variant="outline">Field control</Button></div>
  {#snippet footer()}<p>Settings footer</p>{/snippet}
</SettingsPageShell>

<output aria-label="Back action count">{backCount}</output>

<SettingsPageShell title="Linked settings" backHref="/" backLabel="Linked back" measure="wide">
  <p>Linked shell content</p>
</SettingsPageShell>
