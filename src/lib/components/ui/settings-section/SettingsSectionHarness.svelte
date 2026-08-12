<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SettingsSection from './settings-section.svelte';
</script>

<SettingsSection
  id="notifications"
  title="Notifications"
  description="Choose how the application gets your attention."
  busy
  error="Unable to save notification settings."
>
  {#snippet actions()}<Button variant="outline" size="sm">Reset section</Button>{/snippet}
  <p>Section fields</p>
</SettingsSection>
