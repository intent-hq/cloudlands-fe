<script lang="ts">
  import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import EventWakeupBanner from '$lib/components/chat/EventWakeupBanner.svelte';
  import ChatFileChangesSummary from '$lib/components/chat/ChatFileChangesSummary.svelte';
  import EventSubscriptionsCard from '$lib/components/chat/EventSubscriptionsCard.svelte';
  import SuggestedPrompts from '$lib/components/chat/SuggestedPrompts.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { chatPolishFixtureAdapter } from '../chat-polish/chat-polish-fixture-adapter';
  import { getChatPolishScenario } from '../chat-polish/chat-polish-scenarios';
  import {
    getSubscriptionCardSeam,
    isChatCardMessage,
    isSubscriptionCardMessage,
  } from '$lib/components/chat/subscription-card-spacing';
  import type { ChatPolishScenario } from '../chat-polish/chat-polish-types';

  let {
    fixture,
    compact = false,
    stickySimulation = false,
  }: { fixture: UiComponentFixture; compact?: boolean; stickySimulation?: boolean } = $props();
  const scenario = $derived(getChatPolishScenario(fixture.id));

  function isCard(item: ChatPolishScenario['items'][number] | undefined) {
    return (
      item?.kind === 'wake' ||
      item?.kind === 'subscriptions' ||
      (item?.kind === 'message' && isChatCardMessage(item.message))
    );
  }

  function subscriptionAgents(count: number, finishedCount = 0) {
    return Array.from({ length: count }, (_, index) => ({
      id: `fixture-agent-${index + 1}`,
      name: m.sandbox_chatPolish_agentName_label({ number: String(index + 1) }),
      finished: index >= count - finishedCount,
    }));
  }
</script>

<div
  class="chat-polish-preview mx-auto w-full min-w-0 overflow-hidden bg-background text-foreground"
  data-testid="chat-polish-preview"
  data-fixture-isolation={chatPolishFixtureAdapter.mode}
  data-compact={compact}
  data-sticky-simulated={stickySimulation}
>
  {#if scenario}
    <div
      class="chat-polish-conversation flex min-w-0 flex-col"
      data-chat-polish-conversation={scenario.id}
      data-testid="chat-polish-conversation"
    >
      {#each scenario.items as item, index (item.kind === 'message' ? item.message.id : item.id)}
        {@const previousItem = scenario.items[index - 1]}
        {@const previousIsCard = isCard(previousItem)}
        {@const currentIsCard = isCard(item)}
        {@const seam =
          index > 0 ? getSubscriptionCardSeam(previousIsCard, currentIsCard) : undefined}
        {#if seam}
          <div
            class="chat-polish-card-gap"
            data-card-seam={seam}
            data-before-card={currentIsCard}
            data-after-user-bubble={seam === 'content' &&
              previousItem?.kind === 'message' &&
              previousIsCard &&
              !isSubscriptionCardMessage(previousItem.message)}
            aria-hidden="true"
          ></div>
        {/if}
        {#if item.kind === 'message'}
          <div class="chat-polish-message" data-preview-message-role={item.message.role}>
            <ChatMessage
              message={item.message}
              isStreaming={item.isStreaming}
              suppressAutomatedWakeTopSpacing
              isSticky={item.message.role === 'user' && (stickySimulation || item.isSticky)}
              readOnly={chatPolishFixtureAdapter.readOnly}
              {...chatPolishFixtureAdapter.messageProps}
            />
          </div>
        {:else if item.kind === 'wake'}
          <div class="chat-polish-wake" data-conversation-event={item.id}>
            <EventWakeupBanner
              metadata={{ type: 'event_notification', ...item.wake }}
              asDivider
              suppressTopGap
              {compact}
              showAgentCards={false}
            />
          </div>
        {:else if item.kind === 'subscriptions'}
          <div
            class="chat-polish-subscription"
            data-subscription-cohort={item.cohort}
            data-subscription-expanded={item.expanded}
          >
            <EventSubscriptionsCard
              workspaceId={chatPolishFixtureAdapter.workspaceId}
              agentId={`${chatPolishFixtureAdapter.parentAgentId}-${item.id}`}
              isolatedPreview={{
                count: item.agentCount,
                initiallyExpanded: item.expanded,
                mode: 'agents',
                agents: subscriptionAgents(item.agentCount, item.finishedCount),
              }}
              {compact}
              suppressTopGap
            />
          </div>
        {:else if item.kind === 'changed-files'}
          <ChatFileChangesSummary
            workspaceId={chatPolishFixtureAdapter.workspaceId}
            message={item.message}
            readOnly
          />
        {:else}
          <div inert data-conversation-event={item.id}>
            <SuggestedPrompts prompts={item.prompts} onSelect={() => {}} {compact} />
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .chat-polish-preview {
    width: min(100%, var(--chat-polish-panel-width, 510px));
    padding: var(--chat-polish-content-inset, 22px);
    border-radius: var(--chat-polish-card-radius, 9px);
  }
  .chat-polish-card-gap {
    height: var(--chat-polish-wake-bottom-gap, 24px);
    flex-shrink: 0;
  }
  .chat-polish-card-gap[data-before-card='true'] {
    height: var(--chat-polish-wake-top-gap, 24px);
  }
  .chat-polish-card-gap[data-after-user-bubble='true'] {
    height: var(--chat-polish-user-bottom-gap, 24px);
  }
  .chat-polish-card-gap[data-card-seam='cards'] {
    height: var(--chat-polish-subscription-bottom-gap, 16px);
  }
  :global(.chat-polish-preview .turn-failure-notice) {
    margin-block: var(--chat-polish-failure-notice-top-gap, 16px)
      var(--chat-polish-failure-notice-bottom-gap, 16px);
  }
  :global(.chat-polish-preview [data-testid='event-wakeup-card']),
  :global(.chat-polish-preview [data-testid='event-subscriptions-card']),
  :global(.chat-polish-preview [data-testid='user-message-surface']) {
    border-radius: var(--chat-polish-card-radius, 9px) !important;
  }
  :global(.chat-polish-preview [data-testid='event-wakeup-header']),
  :global(.chat-polish-preview [data-subscription-row]) {
    padding-inline: var(--chat-polish-row-padding, 12px) !important;
  }
</style>
