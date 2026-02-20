<script lang="ts">
  import { faLightbulb } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    digest: string;
  }

  let { digest }: Props = $props();
</script>

<div class="digest-card flex items-start gap-2 px-3.5 py-1.5 bg-muted/50 rounded-lg mt-5">
  <!-- <div class="shrink-0 text-muted-foreground mt-0.5">
    <Fa icon={faLightbulb} size="xs" />
  </div> -->
  <div class="text-sm leading-relaxed text-muted-foreground">
    {digest}
  </div>
</div>
