<script lang="ts">
  import Fa from 'svelte-fa';
  import { faArrowRightArrowLeft } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatEffortChangeLabel, type EffortChangeNoticeInfo } from './effort-change-notice';

  interface Props {
    notice: EffortChangeNoticeInfo;
    fallbackText?: string;
  }

  let { notice, fallbackText = m.chat_effortChangeNotice_fallback_label() }: Props = $props();
  const label = $derived(formatEffortChangeLabel(notice, fallbackText));
</script>

<div class="my-4 flex w-full min-w-0 items-center gap-3" role="status">
  <div class="h-px min-w-4 flex-1 bg-border"></div>
  <span class="flex min-w-0 shrink items-start gap-2 text-left text-xs text-muted-foreground">
    <Fa icon={faArrowRightArrowLeft} class="mt-0.5 h-3 w-3 flex-shrink-0" />
    <span class="min-w-0 break-words">{label}</span>
  </span>
  <div class="h-px min-w-4 flex-1 bg-border"></div>
</div>
