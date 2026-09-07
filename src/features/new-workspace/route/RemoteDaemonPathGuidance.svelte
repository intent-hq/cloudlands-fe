<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    path: string;
  }

  let { path }: Props = $props();
</script>

<div
  class="type-caption absolute inset-x-4 top-4 z-50 mx-auto max-w-xl rounded-lg border border-border bg-background p-3 text-foreground shadow-lg"
  role="alert"
  data-remote-daemon-path-guidance
>
  <p>{m.newWorkspace_source_remoteDaemonPath_description()}</p>
  <code class="mt-1 block break-all text-muted-foreground">{path}</code>
</div>
