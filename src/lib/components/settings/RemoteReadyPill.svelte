<script lang="ts">
  /** "Remote Ready": the configuration is marked for remote machines (like the Default and Backup pills). */
  import { m } from '$shared/paraglide/messages.js';
</script>

<span
  class="shrink-0 rounded-full bg-muted px-2 py-0.5 type-caption text-subtle"
  data-testid="provider-profile-remote-ready-badge"
>
  {m.settings_providerRemote_pill_label()}
</span>
