<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Tabs from '$lib/components/ui/tabs';
  import SettingsPageShell from './settings-page-shell.svelte';

  let backCount = $state(0);
  let activeSection = $state('general');
</script>

<SettingsPageShell
  title="Application settings"
  description="Configure the application without changing workspace state."
  backLabel="Back to workspace"
  backShortcut="⌘,"
  backShortcutLabel="Command comma"
  onBack={() => (backCount += 1)}
  busy
  bind:navigationValue={activeSection}
  navigationLabel="Settings sections"
>
  {#snippet navigation()}
    <Tabs.Trigger value="general">General</Tabs.Trigger>
    <Tabs.Trigger value="appearance">Appearance and colors</Tabs.Trigger>
    <Tabs.Trigger value="accounts">Accounts and providers</Tabs.Trigger>
  {/snippet}
  <div class="min-h-96"><Button variant="outline">Field control</Button></div>
  {#snippet footer()}<p>Settings footer</p>{/snippet}
</SettingsPageShell>

<output aria-label="Back action count">{backCount}</output>
<output aria-label="Active settings section">{activeSection}</output>

<SettingsPageShell title="Linked settings" backHref="/" backLabel="Linked back" measure="wide">
  <p>Linked shell content</p>
</SettingsPageShell>
