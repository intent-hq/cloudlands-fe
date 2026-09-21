<script lang="ts">
  import { extractAllContent, type AgentMessage, type Workspace } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import { getAgentMessageAttribution } from '$lib/utils/agent-message-attribution';
  import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';
  import { getPrMonitorWakeChipLabel } from '$lib/utils/pr-monitor-wake-attribution';
  import { getAutomatedWakePresentation } from './automated-wake-presentation';
  import { isEventWakeMessage } from './event-wake-summary';
  import EventWakeupBanner from './EventWakeupBanner.svelte';
  import AgentMessageAttributionHeader from './AgentMessageAttributionHeader.svelte';
  import AutomatedWakeCardHeader from './AutomatedWakeCardHeader.svelte';
  import {
    SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
    SUBSCRIPTION_CARD_SURFACE_CLASS,
  } from './subscription-disclosure';
  import PinnedUserPrompt from './PinnedUserPrompt.svelte';
  import type { ComponentProps } from 'svelte';

  interface Props {
    message: AgentMessage;
    surface?: 'user' | 'subscription';
    workspace?: Workspace | null;
    onActivate: () => void;
  }

  let { message, surface = 'user', workspace = null, onActivate }: Props = $props();
  const eventWake = $derived(isEventWakeMessage(message));
  const attribution = $derived(getAgentMessageAttribution(message.metadata));
  const wake = $derived(getAutomatedWakePresentation(message));
  const text = $derived.by(() => {
    const body = getPresentedUserMessageText(message);
    if (attribution) {
      const name =
        attribution.kind === 'chief' ? m.layout_chiefCard_title() : attribution.displayName;
      return m.events_activity_nameSentMessage_label({ name });
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
      return label;
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
{:else if attribution || wake}
  <div
    class="pointer-events-auto {SUBSCRIPTION_CARD_CONTAINMENT_CLASS} {SUBSCRIPTION_CARD_SURFACE_CLASS}"
    data-testid="pinned-user-prompt"
    title={text}
  >
    {#if attribution}
      {#key attribution.fromAgentId}
        <AgentMessageAttributionHeader
          {attribution}
          expanded={false}
          controlsId=""
          ontoggle={onActivate}
          onPinnedActivate={onActivate}
        />
      {/key}
    {:else if wake}
      <AutomatedWakeCardHeader
        presentation={wake}
        expanded={false}
        controlsId=""
        {workspace}
        ontoggle={onActivate}
        onPinnedActivate={onActivate}
      />
    {/if}
  </div>
{:else}
  <PinnedUserPrompt {text} {surface} {onActivate} />
{/if}
