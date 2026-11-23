<script lang="ts">
  import ChatInlineDivider from './ChatInlineDivider.svelte';
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

<ChatInlineDivider icon={faArrowRightArrowLeft}>
  <span class="min-w-0 break-words">{label}</span>
</ChatInlineDivider>
