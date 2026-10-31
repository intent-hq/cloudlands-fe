<script lang="ts">
  /**
   * Centered chip for a daemon-delivered secret-request notice row
   * (`secret_provided` / `secret_declined`, PROTOCOL §5.56) — the row tells
   * the agent the outcome and never carries the value.
   */
  import Fa from 'svelte-fa';
  import { faKey } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import type { SecretRequestNoticeInfo } from './secret-request-notice';

  interface Props {
    notice: SecretRequestNoticeInfo;
  }

  let { notice }: Props = $props();
</script>

<div
  class="flex items-center gap-3 my-4 w-full"
  role="status"
  data-testid="secret-request-notice"
  data-outcome={notice.outcome}
>
  <div class="h-px flex-1 bg-border"></div>
  <span class="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
    <Fa icon={faKey} class="w-3 h-3 flex-shrink-0" />
    {notice.outcome === 'provided'
      ? m.chat_secretRequest_noticeProvided_label({ name: notice.name })
      : m.chat_secretRequest_noticeDeclined_label({ name: notice.name })}
  </span>
  <div class="h-px flex-1 bg-border"></div>
</div>
