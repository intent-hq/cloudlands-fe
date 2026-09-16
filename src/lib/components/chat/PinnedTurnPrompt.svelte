<script lang="ts">
  import { faBolt, faCodePullRequest, faRobot } from '@fortawesome/free-solid-svg-icons';
  import { extractAllContent, type AgentMessage, type Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
  import { getPrMonitorWakeChipLabel } from '$lib/utils/pr-monitor-wake-attribution';
  import { getAutomatedWakePresentation } from './automated-wake-presentation';
  import { isEventWakeMessage } from './event-wake-summary';
  import EventWakeupBanner from './EventWakeupBanner.svelte';
  import PinnedUserPrompt from './PinnedUserPrompt.svelte';
  import type { ComponentProps } from 'svelte';

  interface Props {
    message: AgentMessage;
    workspace?: Workspace | null;
    onActivate: () => void;
  }

  let { message, workspace = null, onActivate }: Props = $props();
  const eventWake = $derived(isEventWakeMessage(message));
  const attribution = $derived(getAgentMessageAttribution(message.metadata));
  const wake = $derived(getAutomatedWakePresentation(message));
  const icon = $derived(
    attribution ? faRobot : wake?.kind === 'hook' ? faBolt : wake ? faCodePullRequest : undefined,
  );
  const text = $derived.by(() => {
    const body = getPresentedUserMessageText(message);
    if (attribution) {
      const name =
        attribution.kind === 'chief' ? m.layout_chiefCard_title() : attribution.displayName;
      const label = m.events_activity_nameSentMessage_label({ name });
      return body.trim() ? `${label} — ${body.trim()}` : label;
    }
    if (wake) {
      const repo =
        workspace?.repositoryOwner && workspace?.repositoryName
          ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
          : undefined;
      const label =
        wake.kind === 'hook'
          ? wake.attribution.displayName
          : getPrMonitorWakeChipLabel(wake.attribution, repo);
      return wake.bodyText ? `${label} — ${wake.bodyText}` : label;
    }
    if (body.trim()) return body.trim();
    const attachment = message.contentBlocks?.find(
      (block) => block.type === 'image' || block.type === 'file',
    );
    if (attachment?.type === 'file' && attachment.fileName) return attachment.fileName;
    if (attachment?.type === 'image') {
      return m.chat_chatMessage_attachedImage_fallback({ number: '1' });
    }
    return m.chat_shared_context_fallback();
  });
</script>

{#if eventWake}
  <EventWakeupBanner
    metadata={message.metadata as ComponentProps<typeof EventWakeupBanner>['metadata']}
    messageText={extractAllContent(message)}
    {workspace}
    onPinnedActivate={onActivate}
  />
{:else}
  <PinnedUserPrompt {text} {icon} {onActivate} />
{/if}
