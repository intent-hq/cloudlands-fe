<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCircleCheck, faCircleXmark } from '@fortawesome/free-solid-svg-icons';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
  } from './operational-disclosure-row';

  interface Props {
    status: 'running' | 'completed' | 'error';
  }

  let { status }: Props = $props();
  const presentation = $derived.by(() => {
    if (status === 'running') {
      return {
        icon: null,
        label: m.workspace_devScripts_running_label(),
        className: 'text-muted-foreground',
      };
    }
    if (status === 'error') {
      return {
        icon: faCircleXmark,
        label: m.chat_toolCall_failed_label(),
        className: 'text-danger',
      };
    }
    return {
      icon: faCircleCheck,
      label: m.chat_toolCall_success_label(),
      className: 'text-success',
    };
  });
</script>

<span
  class="{CHAT_OPERATIONAL_LEADING_CLASS} shrink-0 {presentation.className}"
  data-testid="tool-call-status"
  data-tool-status={status === 'completed' ? 'success' : status}
  role="img"
  aria-label={presentation.label}
  title={presentation.label}
>
  {#if presentation.icon}
    <Fa icon={presentation.icon} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
  {:else}
    <IntentMarkLoader size={12} class={CHAT_OPERATIONAL_ICON_CLASS} />
  {/if}
  <span class="sr-only">{presentation.label}</span>
</span>
