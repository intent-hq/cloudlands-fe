<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import SettingsFieldRow from './settings-field-row.svelte';
</script>

<SettingsFieldRow
  id="volume-row"
  label="Notification volume"
  description="Controls the volume used for application notifications."
  htmlFor="volume-control"
  error="Choose a valid volume."
  disabled
  busy
  compact
>
  <Input id="volume-control" aria-invalid="true" />
</SettingsFieldRow>
