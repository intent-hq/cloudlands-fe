<script lang="ts">
  import { faQuoteLeft } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    digest: string;
  }

  let { digest }: Props = $props();
</script>

<div class="digest-card flex items-start gap-2.5 p-4 rounded-lg my-4 border border-primary/20 bg-primary/5">
  <div class="shrink-0 text-primary/50 mt-0.5">
    <Fa icon={faQuoteLeft} size="sm" />
  </div>
  <div class="text-sm leading-relaxed text-foreground font-medium">
    {digest}
  </div>
</div>
